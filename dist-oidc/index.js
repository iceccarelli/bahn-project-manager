// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "node:http";
import net from "node:net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/bahnhofsmanagement.ts
var BAHNHOFSMANAGEMENT = [
  "Darmstadt",
  "Frankfurt",
  "Gie\xDFen",
  "Kaiserslautern",
  "Kassel",
  "Koblenz",
  "Mainz",
  "Saarbr\xFCcken",
  "\xFCbergreifend"
];
var STATION_BAHNHOFSMANAGEMENT = BAHNHOFSMANAGEMENT.filter(
  (bm) => bm !== "\xFCbergreifend"
);
var PLACEHOLDER_SOURCE = ["", "-", "???", "?", "n/a", "na", "null", "none", "bitte ausw\xE4hlen", "bitte auswaehlen", "keine angabe"];
var ALIASES = {
  // station master spelling
  "frankfurt a m": "Frankfurt",
  "frankfurt am main": "Frankfurt",
  "frankfurt main": "Frankfurt",
  "frankfurt a.m.": "Frankfurt",
  "ffm": "Frankfurt",
  // observed typos in data.json
  "saabrucken": "Saarbr\xFCcken",
  "saarbruecken": "Saarbr\xFCcken",
  "giessen": "Gie\xDFen",
  // cross-regional
  "uebergreifend": "\xFCbergreifend",
  "ubergreifend": "\xFCbergreifend",
  "rb mitte": "\xFCbergreifend"
};
function fold(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}
var PLACEHOLDERS = new Set(PLACEHOLDER_SOURCE.map(fold));
var CANONICAL_BY_FOLD = new Map(
  BAHNHOFSMANAGEMENT.map((bm) => [fold(bm), bm])
);
var ALIAS_BY_FOLD = new Map(
  Object.entries(ALIASES).map(([k, v]) => [fold(k), v])
);
function normalizeBahnhofsmanagement(raw) {
  if (raw == null) return { value: null, unmapped: null, changed: false };
  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  const key2 = fold(cleaned);
  if (PLACEHOLDERS.has(key2)) {
    return { value: null, unmapped: null, changed: cleaned !== "" };
  }
  const direct = CANONICAL_BY_FOLD.get(key2);
  if (direct) return { value: direct, unmapped: null, changed: direct !== cleaned };
  const alias = ALIAS_BY_FOLD.get(key2);
  if (alias) return { value: alias, unmapped: null, changed: true };
  const lot = /^(.+?)\s+los\s*\d+$/.exec(key2);
  const lotBase = lot?.[1];
  if (lotBase) {
    const base = CANONICAL_BY_FOLD.get(lotBase) ?? ALIAS_BY_FOLD.get(lotBase);
    if (base) return { value: base, unmapped: null, changed: true };
  }
  return { value: null, unmapped: cleaned, changed: true };
}

// shared/validation.ts
import { z } from "zod";

// shared/checklist.ts
var JA_NEIN = ["Ja", "Nein"];
var FREISCHALTUNG_OPTIONS = [
  "Erforderlich",
  "Bereits vorhanden",
  "Mieterbaukoordination"
];
var UNANSWERED = "Bitte ausw\xE4hlen";
var UNFILLED = "Bitte ausf\xFCllen";
var CHECKLIST_MODES = ["Projektanmeldung", "Projektkonfiguration"];
function both(def) {
  return {
    Projektanmeldung: { visible: true, default: def },
    Projektkonfiguration: { visible: true, default: def }
  };
}
var CHECKLIST_QUESTIONS = [
  {
    nr: 1,
    key: "pkpLink",
    formularRow: 13,
    gewerk: "Alle",
    question: "Link zu den auf der PKP zur Pr\xFCfung bereitgestellten Dokumenten:",
    kind: "admin",
    department: null,
    answerType: "text",
    modes: {
      Projektanmeldung: { visible: true, default: UNFILLED },
      Projektkonfiguration: { visible: false, default: null }
    }
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
    hint: 'Wenn Sie "Erforderlich" ausw\xE4hlen, werden die Mitarbeitenden der FAA automatisch \xFCber die erforderlichen Freischaltungen informiert.',
    modes: {
      Projektanmeldung: { visible: true, default: UNANSWERED },
      Projektkonfiguration: { visible: true, default: "Erforderlich" }
    }
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
    hint: 'Wenn Sie "Erforderlich" ausw\xE4hlen, wird das Unterschriftenblatt automatisch in Ihrem Downloadordner abgelegt.',
    modes: {
      // NOT reset by Sub Projektanmeldung() — see the note above.
      Projektanmeldung: { visible: true, default: null },
      Projektkonfiguration: { visible: false, default: null }
    }
  },
  {
    nr: 4,
    key: "mitProjektvorstellung",
    formularRow: 16,
    gewerk: "Alle",
    question: 'Projekt mit Projektvorstellung anmelden?\nBei "Nein" nur nach vorheriger Abstimmung mit Fachspezialisten und TBQ m\xF6glich\n(z.B. Sonderprojekte, BSK)',
    kind: "admin",
    department: null,
    answerType: "jaNein",
    hint: "Nur bei Nein ausf\xFCllen\nDatum der \xDCbergabe von vollst\xE4ndigen zu pr\xFCfenden Unterlagen:",
    modes: {
      Projektanmeldung: { visible: true, default: "Ja" },
      Projektkonfiguration: { visible: false, default: null }
    }
  },
  {
    nr: 5,
    key: "itk",
    formularRow: 17,
    gewerk: "Informations- und Telekommunikationstechnologien (ITK)",
    question: "Sind Telekommunikationsanlagen u.a. bei Arbeiten an: Beschallungsanlagen (Lautsprecher), Zuganzeiger (FIA/ZIM), Uhren, W-Lan, Video betroffen?",
    kind: "gewerk",
    department: "ITK",
    answerType: "jaNein",
    secondary: { label: "sonstige TK-Ma\xDFnahme" },
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 7,
    key: "eea",
    formularRow: 18,
    gewerk: "Eletrotechnische Anlagen (50 Hz)",
    question: "Sind elektrotechnischen Anlagen u.a. Arbeiten an: Allgemeine Beleuchtungsanlagen, Notbeleuchtung,\nSchaltger\xE4tekombination (Unterverteiler, Hauptverteiler und Z\xE4hlerverteiler), Erdungssysteme (PAS, Bahnerde etc.) betroffen?",
    kind: "gewerk",
    department: "EEA",
    answerType: "jaNein",
    secondary: { label: "sonstige elektrotechnische Ma\xDFnahme" },
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
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
    secondary: { label: "Empfangsgeb\xE4ude vorhanden ggf.\nRestnutzung" },
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 9,
    key: "foerdertechnik",
    formularRow: 20,
    gewerk: "F\xF6rdertechnik",
    question: "Sind Aufz\xFCge oder Fahrtreppen betroffen?",
    kind: "gewerk",
    department: "HFT",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 10,
    key: "hkls",
    formularRow: 21,
    // "ii" is a footnote marker in the workbook, referring to the note in A4
    // ("Außer Bahnsteigentwässerung - Zuständigkeit DB Immobilien/Kanalmanagement").
    gewerk: "Heizung, L\xFCftung, Sanit\xE4r (HLS)",
    question: "Sind Heizungsanlagen, Entl\xFCftung- und/oder Entrauchungsanlagen oder Klimatechnik betroffen?",
    kind: "gewerk",
    department: "HKLS",
    answerType: "jaNein",
    hint: "Au\xDFer Bahnsteigentw\xE4sserung \u2014 Zust\xE4ndigkeit DB Immobilien/Kanalmanagement",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 11,
    key: "gebaeudeautomation",
    formularRow: 22,
    gewerk: "Geb\xE4udeautomation",
    question: "Bei allen TGA-Anlagen, au\xDFer ITK\n(z.B. Hebeanlagen | Sicherheitsbeleuchtung | Brandmeldeanlagen) nach Ril 813.0480",
    kind: "gewerk",
    department: "GA",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 12,
    key: "energiemanagement",
    formularRow: 23,
    gewerk: "Energiemanagement",
    question: "Findet eine Medientrennung statt?\nFindet der Einbau eines Stromz\xE4hlers statt?",
    kind: "gewerk",
    department: "Energie",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 13,
    key: "tbq",
    formularRow: 24,
    gewerk: "TBQ",
    question: "Ist z.B. eines der folgenden Themen betroffen?\nEIGV-Einstufung, Planrecht-Einsch\xE4tzung, CSM, RIL 813.02, Mieterumbau",
    kind: "gewerk",
    department: "TBQ",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 14,
    key: "umweltmanagement",
    formularRow: 25,
    gewerk: "Umweltmanagement",
    question: "Ist eine Abarbeitung des Umwelt-Checks erfolgt?\nLiegen Betroffenheiten der dort aufgef\xFChrten Umweltbelange vor?\n(z.B. Immissionsschutz, Natur- und Artenschutz, Abfall und Entsorgung, Gew\xE4sserschutz...)",
    kind: "gewerk",
    department: "UM",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
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
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
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
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
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
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 18,
    key: "bim",
    formularRow: 29,
    gewerk: "BIM-Spezialisten",
    question: "Einbindung und Pr\xFCfung nach BIM Methodik",
    kind: "gewerk",
    department: "BIM",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 19,
    key: "lst",
    formularRow: 30,
    gewerk: "LST",
    question: "Anlagen der DB Netz AG zum Thema Leit- und Sicherungstechnik, Signalanlagen, Bahn\xFCberg\xE4nge, Gleisfreimeldeanlagen und sonstige Themen",
    kind: "gewerk",
    department: "LST",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 20,
    key: "vermessung",
    formularRow: 31,
    gewerk: "Vermessung",
    question: "Ist eine vermessungstechnische Aufgabenstellung erforderlich; Pr\xFCfen ob Punktwolke notwendig",
    kind: "gewerk",
    department: "Vermessung",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 21,
    key: "baubetriebstechnologie",
    formularRow: 32,
    gewerk: "Baubetriebstechnologie",
    question: "Grunds\xE4tzlich ist die Einbindung des BBTL erforderlich",
    kind: "gewerk",
    department: "Baubetriebstechnologie",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      Projektkonfiguration: { visible: true, default: "Ja" }
    }
  },
  {
    nr: 22,
    key: "baubetriebsplanung",
    formularRow: 33,
    gewerk: "Baubetriebsplanung",
    question: "Erst ab Lph 3 zus\xE4tzlich zum Baubetriebstechnologen hinzuzuf\xFCgen",
    kind: "gewerk",
    department: "Baubetriebsplanung",
    answerType: "jaNein",
    modes: {
      Projektanmeldung: { visible: true, default: "Nein" },
      // hidden AND forced to "Nein" — the only Gewerk not auto-selected in this mode
      Projektkonfiguration: { visible: false, default: "Nein" }
    }
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
    modes: both(null)
  }
];
var CHECKLIST_BY_KEY = Object.freeze(
  Object.fromEntries(CHECKLIST_QUESTIONS.map((q) => [q.key, q]))
);
var DEPARTMENT_QUESTIONS = CHECKLIST_QUESTIONS.filter(
  (q) => q.department !== null
);

// shared/validation.ts
var DEPARTMENTS = [
  "EEA",
  "ITK",
  "BS",
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "UM",
  "BIM",
  "LST",
  "Vermessung",
  "Baubetriebstechnologie",
  "Baubetriebsplanung"
];
var REVIEW_STATUSES = [
  "nicht erforderlich",
  "offen",
  "Projektkonfig.",
  "in Bearbeitung",
  "Nachforderung",
  "pr\xFCff\xE4hig",
  "Pr\xFCfung erfolgt",
  "Zustimmung erteilt",
  "Niederschrift erstellt",
  "abgelehnt",
  "zur\xFCckgestellt",
  "gestoppt"
];
var ReviewSchema = z.object({
  department: z.enum(DEPARTMENTS),
  // Stored as free text: data.json holds 14 distinct values, including
  // "Niederschrift erstellt (LP05-05-01-F31)" (80 rows), whose annotation is a
  // real document reference. Group with normalizeReviewStatus() from
  // shared/review-status.ts instead of constraining storage.
  status: z.string().max(128).nullable().optional(),
  prueferName: z.string().nullable().optional(),
  pruefDatum: z.string().nullable().optional(),
  id: z.number().optional()
});
var ProjectSchema = z.object({
  id: z.number().optional(),
  originalRowIndex: z.number().nullable().optional(),
  fullRowData: z.record(z.string(), z.any()).nullable().optional(),
  // 15 of the 1,298 rows have no Projektnummer, and the DB column is nullable.
  // Requiring it here is what made scripts/seed-perfect.ts throw on real data.
  projektnummer: z.string().max(256).nullable().optional(),
  bahnhofsmanagement: z.string().max(128).nullable().optional(),
  station: z.string().max(256).nullable().optional(),
  bahnhofsnummer: z.string().max(32).nullable().optional(),
  streckennummer: z.string().max(32).nullable().optional(),
  projektbeschreibung: z.string().max(5e3).nullable().optional(),
  // Free text — 81 distinct values in the wild. Canonicalise for grouping with
  // normalizeProjektstand() from shared/projektstand.ts.
  projektstand: z.string().max(256).nullable().optional(),
  eigvEinstufung: z.string().max(1e3).nullable().optional(),
  projektleiter: z.string().max(256).nullable().optional(),
  terminProjektvorstellung: z.string().nullable().optional(),
  kommentar: z.string().max(5e3).nullable().optional(),
  // Not .url(): the column holds SharePoint paths and free-text notes, and a
  // stricter schema than the data would reject 1,298 rows to no benefit.
  projektLink: z.string().max(2048).nullable().optional(),
  syncVersion: z.number().int().default(1),
  reviews: z.array(ReviewSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
var DepartmentReviewSchema = z.object({
  id: z.number().optional(),
  projectId: z.number(),
  department: z.enum(DEPARTMENTS),
  prueferName: z.string().nullable().optional(),
  datum: z.string().nullable().optional(),
  status: z.string().max(128).nullable().optional()
});
var BvbEeaSchema = z.object({
  id: z.number().optional(),
  projektnummer: z.string(),
  bahnhofsmanagement: z.string().nullable().optional(),
  station: z.string().nullable().optional(),
  bahnhofsnummer: z.string().nullable().optional(),
  streckennummer: z.string().nullable().optional(),
  projektbeschreibung: z.string().nullable().optional(),
  projektleiter: z.string().nullable().optional(),
  eigvAnzeige: z.string().nullable().optional(),
  datum: z.string().nullable().optional(),
  kommentar: z.string().nullable().optional(),
  freigabeNummer: z.string().nullable().optional(),
  kosteneinsparung: z.string().nullable().optional()
});
var PsvItkSchema = z.object({
  id: z.number().optional(),
  projektnummer: z.string(),
  bahnhofsmanagement: z.string().nullable().optional(),
  station: z.string().nullable().optional(),
  bahnhofsnummer: z.string().nullable().optional(),
  streckennummer: z.string().nullable().optional(),
  projektbeschreibung: z.string().nullable().optional(),
  projektstand: z.string().max(256).nullable().optional(),
  projektleiter: z.string().nullable().optional(),
  terminProjektvorstellung: z.string().nullable().optional(),
  itkPruefer: z.string().nullable().optional(),
  datum: z.string().nullable().optional(),
  kommentar: z.string().nullable().optional()
});
var AuditLogSchema = z.object({
  id: z.number().optional(),
  userId: z.number().nullable().optional(),
  userName: z.string().nullable().optional(),
  entityType: z.enum(["project", "department_review", "bvb_eea", "psv_itk"]),
  entityId: z.number(),
  action: z.enum(["create", "update", "delete", "import", "export"]),
  field: z.string().nullable().optional(),
  oldValue: z.any().nullable().optional(),
  newValue: z.any().nullable().optional(),
  createdAt: z.string().optional()
});
var CHECKLIST_QUESTION_KEYS = CHECKLIST_QUESTIONS.map((q) => q.key);
var ChecklistAnswerSchema = z.object({
  questionKey: z.enum(CHECKLIST_QUESTION_KEYS),
  /** Formular column F */
  answer: z.string().max(512).nullable().optional(),
  /** Formular column H — only rows 17/18/19 have one */
  secondary: z.enum(JA_NEIN).nullable().optional(),
  /** Formular column G */
  comment: z.string().max(2e3).nullable().optional()
});
var ProjectChecklistSchema = z.object({
  id: z.number().optional(),
  projectId: z.number().nullable().optional(),
  mode: z.enum(CHECKLIST_MODES),
  status: z.enum(["draft", "submitted", "cancelled"]).default("draft"),
  // Formular rows 6-9
  projektnummer: z.string().max(256).nullable().optional(),
  projektbezeichnung: z.string().max(512).nullable().optional(),
  stationsname: z.string().max(256).nullable().optional(),
  bahnhofsnummer: z.string().max(32).nullable().optional(),
  streckennummer: z.string().max(32).nullable().optional(),
  projektstand: z.string().max(128).nullable().optional(),
  bahnhofsmanagement: z.enum(BAHNHOFSMANAGEMENT).nullable().optional(),
  projektleitung: z.string().max(256).nullable().optional(),
  // Formular rows 13-16
  pkpLink: z.string().max(2048).nullable().optional(),
  freischaltungFaa: z.enum(FREISCHALTUNG_OPTIONS).nullable().optional(),
  unterschriftenblatt: z.enum(FREISCHALTUNG_OPTIONS).nullable().optional(),
  mitProjektvorstellung: z.enum(JA_NEIN).nullable().optional(),
  uebergabeDatum: z.string().nullable().optional(),
  anmerkungen: z.string().max(5e3).nullable().optional(),
  // booked Fachspezialistenprüfung slot
  terminDatum: z.string().nullable().optional(),
  terminVon: z.string().max(8).nullable().optional(),
  terminBis: z.string().max(8).nullable().optional(),
  answers: z.array(ChecklistAnswerSchema).default([]),
  syncVersion: z.number().int().default(1),
  submittedAt: z.string().nullable().optional(),
  submittedBy: z.string().max(256).nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
var ChecklistSubmitSchema = ProjectChecklistSchema.extend({
  projektnummer: z.string().min(1, "Projektnummer ist erforderlich").max(256),
  projektbezeichnung: z.string().min(1, "Projektbezeichnung ist erforderlich").max(512),
  stationsname: z.string().min(1, "Stationsname ist erforderlich").max(256),
  projektstand: z.string().min(1, "Projektstand ist erforderlich").max(128),
  bahnhofsmanagement: z.enum(BAHNHOFSMANAGEMENT),
  projektleitung: z.string().min(1, "Name der Projektleitung ist erforderlich").max(256)
});
var ProjectInputSchema = ProjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncVersion: true,
  fullRowData: true
}).extend({
  reviews: z.array(ReviewSchema.omit({ id: true })).optional()
});
var BulkImportSchema = z.object({
  projects: z.array(ProjectInputSchema),
  mode: z.enum(["upsert", "replace"]).default("upsert"),
  checksum: z.string().optional()
});
var StatsSchema = z.object({
  totalProjects: z.number(),
  statusDistribution: z.array(z.object({ status: z.string(), count: z.number() })),
  regionStats: z.array(z.object({ region: z.string(), count: z.number() })),
  prueferWorkload: z.array(z.object({ name: z.string(), count: z.number() })),
  departmentStats: z.array(z.object({
    department: z.enum(DEPARTMENTS),
    // nullable in the DB (department_reviews.status), free text in data.json
    status: z.string().nullable(),
    count: z.number()
  }))
});
var FiltersSchema = z.object({
  search: z.string().optional(),
  region: z.string().optional(),
  projektleiter: z.string().optional(),
  pruefer: z.string().optional(),
  status: z.string().optional(),
  department: z.enum(DEPARTMENTS).optional(),
  projektstand: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq, like, and, or, sql, desc, asc, inArray, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

// drizzle/schema.ts
import {
  int,
  bigint,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  datetime,
  json,
  index,
  uniqueIndex,
  primaryKey
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
}, (table) => ({
  openIdIdx: uniqueIndex("openId_idx").on(table.openId),
  roleIdx: index("role_idx").on(table.role)
}));
var projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  originalRowIndex: int("originalRowIndex"),
  fullRowData: json("fullRowData"),
  projektnummer: varchar("projektnummer", { length: 256 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  projektstand: varchar("projektstand", { length: 128 }),
  eigvEinstufung: text("eigvEinstufung"),
  projektleiter: varchar("projektleiter", { length: 256 }),
  terminProjektvorstellung: datetime("terminProjektvorstellung"),
  kommentar: text("kommentar"),
  projektLink: text("projektLink"),
  syncVersion: int("syncVersion").default(1).notNull(),
  // ← CRITICAL for optimistic locking & zero drift
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  projektnummerIdx: index("projektnummer_idx").on(table.projektnummer),
  bahnhofsmanagementIdx: index("bahnhofsmanagement_idx").on(table.bahnhofsmanagement),
  stationIdx: index("station_idx").on(table.station),
  projektstandIdx: index("projektstand_idx").on(table.projektstand),
  projektleiterIdx: index("projektleiter_idx").on(table.projektleiter),
  syncVersionIdx: index("syncVersion_idx").on(table.syncVersion),
  regionStandIdx: index("region_stand_idx").on(table.bahnhofsmanagement, table.projektstand),
  // Keyset pagination for the default list order (updatedAt DESC, id DESC).
  updatedAtIdIdx: index("projects_updatedAt_id_idx").on(table.updatedAt, table.id)
}));
var departmentReviews = mysqlTable("department_reviews", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  department: varchar("department", { length: 64 }).notNull(),
  prueferName: varchar("prueferName", { length: 256 }),
  datum: datetime("datum"),
  status: varchar("status", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  projectDeptUnique: uniqueIndex("project_dept_unique").on(table.projectId, table.department),
  projectIdIdx: index("projectId_idx").on(table.projectId),
  departmentIdx: index("department_idx").on(table.department),
  statusIdx: index("status_idx").on(table.status)
}));
var bvbEea = mysqlTable("bvb_eea", {
  id: int("id").autoincrement().primaryKey(),
  projektnummer: varchar("projektnummer", { length: 64 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  projektleiter: varchar("projektleiter", { length: 256 }),
  eigvAnzeige: datetime("eigvAnzeige"),
  datum: datetime("datum"),
  kommentar: text("kommentar"),
  freigabeNummer: varchar("freigabeNummer", { length: 128 }),
  kosteneinsparung: text("kosteneinsparung"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  projektnummerIdx: index("bvb_projektnummer_idx").on(table.projektnummer)
}));
var psvItk = mysqlTable("psv_itk", {
  id: int("id").autoincrement().primaryKey(),
  projektnummer: varchar("projektnummer", { length: 64 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  station: varchar("station", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektbeschreibung: text("projektbeschreibung"),
  projektstand: varchar("projektstand", { length: 128 }),
  projektleiter: varchar("projektleiter", { length: 256 }),
  terminProjektvorstellung: datetime("terminProjektvorstellung"),
  itkPruefer: varchar("itkPruefer", { length: 256 }),
  datum: datetime("datum"),
  kommentar: text("kommentar"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  projektnummerIdx: index("psv_projektnummer_idx").on(table.projektnummer)
}));
var projectChecklists = mysqlTable("project_checklists", {
  id: int("id").autoincrement().primaryKey(),
  /** null while the checklist is still a draft — it is what creates the project */
  projectId: int("projectId"),
  /** "Projektanmeldung" | "Projektkonfiguration" — see shared/checklist.ts */
  mode: varchar("mode", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "cancelled"]).default("draft").notNull(),
  // --- Formular rows 6-9 ---------------------------------------------------
  projektnummer: varchar("projektnummer", { length: 256 }),
  projektbezeichnung: varchar("projektbezeichnung", { length: 512 }),
  stationsname: varchar("stationsname", { length: 256 }),
  bahnhofsnummer: varchar("bahnhofsnummer", { length: 32 }),
  streckennummer: varchar("streckennummer", { length: 32 }),
  projektstand: varchar("projektstand", { length: 128 }),
  bahnhofsmanagement: varchar("bahnhofsmanagement", { length: 128 }),
  projektleitung: varchar("projektleitung", { length: 256 }),
  // --- Formular rows 13-16 (administrative answers) ------------------------
  pkpLink: text("pkpLink"),
  freischaltungFaa: varchar("freischaltungFaa", { length: 64 }),
  unterschriftenblatt: varchar("unterschriftenblatt", { length: 64 }),
  mitProjektvorstellung: varchar("mitProjektvorstellung", { length: 8 }),
  /** only filled when mitProjektvorstellung = "Nein" (Formular G16) */
  uebergabeDatum: datetime("uebergabeDatum"),
  anmerkungen: text("anmerkungen"),
  // --- booked Fachspezialistenprüfung slot ---------------------------------
  terminDatum: datetime("terminDatum"),
  terminVon: varchar("terminVon", { length: 8 }),
  terminBis: varchar("terminBis", { length: 8 }),
  submittedAt: timestamp("submittedAt"),
  submittedBy: varchar("submittedBy", { length: 256 }),
  syncVersion: int("syncVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  checklistProjectIdx: index("checklist_projectId_idx").on(table.projectId),
  checklistStatusIdx: index("checklist_status_idx").on(table.status),
  checklistProjektnummerIdx: index("checklist_projektnummer_idx").on(table.projektnummer),
  checklistTerminIdx: index("checklist_termin_idx").on(table.terminDatum),
  checklistBmIdx: index("checklist_bahnhofsmanagement_idx").on(table.bahnhofsmanagement)
}));
var projectChecklistAnswers = mysqlTable("project_checklist_answers", {
  id: int("id").autoincrement().primaryKey(),
  checklistId: int("checklistId").notNull(),
  /** CHECKLIST_QUESTIONS[].key */
  questionKey: varchar("questionKey", { length: 64 }).notNull(),
  /** the Nr. printed in Formular column A — 1-5 and 7-23; there is no 6 */
  nr: int("nr").notNull(),
  /** column F: "Ja" | "Nein" | a Freischaltung option | free text */
  answer: varchar("answer", { length: 512 }),
  /** column H: the second Ja/Nein on rows 17, 18 and 19 only */
  secondary: varchar("secondary", { length: 8 }),
  /** column G */
  comment: text("comment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({
  answerUnique: uniqueIndex("checklist_question_unique").on(table.checklistId, table.questionKey),
  answerChecklistIdx: index("answer_checklistId_idx").on(table.checklistId),
  answerQuestionIdx: index("answer_questionKey_idx").on(table.questionKey)
}));
var auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  userName: varchar("userName", { length: 256 }),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  field: varchar("field", { length: 128 }),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  /**
   * Link to the domain event written in the same transaction. Null for rows
   * written before the event pipeline existed. audit_log is append-only: a
   * database trigger (migration 0004) rejects UPDATE and DELETE.
   */
  eventId: varchar("eventId", { length: 36 }),
  aggregateVersion: int("aggregateVersion"),
  traceId: varchar("traceId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({
  entityIdx: index("entity_idx").on(table.entityType, table.entityId),
  userIdx: index("user_idx").on(table.userId),
  createdAtIdx: index("createdAt_idx").on(table.createdAt)
}));
var domainEvents = mysqlTable("domain_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 36 }).notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  aggregateType: varchar("aggregateType", { length: 32 }).notNull(),
  aggregateId: int("aggregateId").notNull(),
  aggregateVersion: int("aggregateVersion").notNull(),
  /** the full wire envelope, exactly as it is published */
  envelope: json("envelope").notNull(),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull(),
  processedAt: datetime("processedAt", { fsp: 3 }),
  /**
   * Dead letter: set (together with processedAt, so the relay skips the row)
   * when the stored envelope can never be published, e.g. it fails schema
   * validation. Transient bus failures are NOT dead-lettered; they retry.
   * Clients detect the resulting version gap and recover from state.
   */
  failedAt: datetime("failedAt", { fsp: 3 }),
  /**
   * Position in the authoritative change feed. Assigned by the (single) outbox
   * relay in publication order, so it is gapless and commit-ordered — unlike
   * `id`, where a slow transaction can commit after a later id. Clients keep it
   * as their resume cursor; see docs/data-plane.md "Collection recovery".
   */
  feedSeq: bigint("feedSeq", { mode: "number" }),
  failureReason: varchar("failureReason", { length: 512 })
}, (table) => ({
  eventIdUnique: uniqueIndex("domain_events_eventId_uq").on(table.eventId),
  aggregateVersionUnique: uniqueIndex("domain_events_aggregate_version_uq").on(
    table.aggregateType,
    table.aggregateId,
    table.aggregateVersion
  ),
  // (processedAt, id): measured 0.8 ms vs 26 ms at a 100k backlog — the relay orders by id,
  // and (processedAt, createdAt, id) forced a filesort of the whole backlog every poll.
  feedSeqUnique: uniqueIndex("domain_events_feedSeq_uq").on(table.feedSeq),
  // relay: resume rows that already have a sequence, in sequence order, without scanning processed history
  pendingSeqIdx: index("domain_events_pending_seq_idx").on(table.processedAt, table.feedSeq),
  outboxIdx: index("domain_events_outbox_idx").on(table.processedAt, table.id)
}));
var idempotencyKeys = mysqlTable("idempotency_keys", {
  actorId: varchar("actorId", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  operation: varchar("operation", { length: 64 }).notNull(),
  /** sha256 of the canonical request, so a reused key with a new body is rejected */
  requestHash: varchar("requestHash", { length: 64 }).notNull(),
  response: json("response"),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.actorId, table.idempotencyKey] }),
  createdAtIdx: index("idempotency_createdAt_idx").on(table.createdAt)
}));
var notifications = mysqlTable("notifications", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  /** principal id of the recipient */
  userId: varchar("userId", { length: 64 }).notNull(),
  kind: mysqlEnum("kind", ["critical", "workflow", "assignment", "mention", "deadline", "system"]).notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  body: varchar("body", { length: 1024 }),
  link: varchar("link", { length: 256 }),
  workspace: varchar("workspace", { length: 128 }),
  /** the domain event that caused it */
  eventId: varchar("eventId", { length: 36 }).notNull(),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull(),
  readAt: datetime("readAt", { fsp: 3 })
}, (table) => ({
  userIdx: index("notifications_user_idx").on(table.userId, table.id),
  userEventUnique: uniqueIndex("notifications_user_event_uq").on(table.userId, table.eventId)
}));
var projectWatchers = mysqlTable("project_watchers", {
  projectId: int("projectId").notNull(),
  userId: varchar("userId", { length: 64 }).notNull(),
  createdAt: datetime("createdAt", { fsp: 3 }).notNull()
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.userId] }),
  userIdx: index("watchers_user_idx").on(table.userId)
}));
var projectsRelations = relations(projects, ({ many }) => ({
  reviews: many(departmentReviews),
  checklists: many(projectChecklists)
}));
var departmentReviewsRelations = relations(departmentReviews, ({ one }) => ({
  project: one(projects, {
    fields: [departmentReviews.projectId],
    references: [projects.id]
  })
}));
var projectChecklistsRelations = relations(projectChecklists, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectChecklists.projectId],
    references: [projects.id]
  }),
  answers: many(projectChecklistAnswers)
}));
var projectChecklistAnswersRelations = relations(projectChecklistAnswers, ({ one }) => ({
  checklist: one(projectChecklists, {
    fields: [projectChecklistAnswers.checklistId],
    references: [projectChecklists.id]
  })
}));

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID || "bahn-project-manager",
  cookieSecret: process.env.JWT_SECRET || "demo-jwt-secret-change-in-production-2024",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var makeDb = (pool) => drizzle({ client: pool });
var _db = null;
var _pool = null;
function getPool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
      queueLimit: Number(process.env.DB_QUEUE_LIMIT ?? 200),
      waitForConnections: true,
      timezone: "Z",
      dateStrings: false,
      charset: "utf8mb4"
    });
  }
  return _pool;
}
var _relayPool = null;
function getRelayPool() {
  if (!_relayPool && process.env.DATABASE_URL) {
    _relayPool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: Number(process.env.RELAY_POOL_SIZE ?? 3),
      queueLimit: 10,
      waitForConnections: true,
      timezone: "Z",
      charset: "utf8mb4"
    });
  }
  return _relayPool;
}
async function getDb() {
  if (!_db) {
    const pool = getPool();
    if (pool) _db = makeDb(pool);
  }
  return _db;
}
async function closeDb() {
  const pools = [_pool, _relayPool];
  _pool = null;
  _relayPool = null;
  _db = null;
  await Promise.all(pools.map((p) => p?.end()));
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function createDepartmentReview(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(departmentReviews).values(data);
  return result[0].insertId;
}
async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  const totalResult = await db.select({ total: count() }).from(projects);
  const totalProjects = totalResult[0]?.total ?? 0;
  const statusDist = await db.select({
    status: departmentReviews.status,
    count: count()
  }).from(departmentReviews).groupBy(departmentReviews.status);
  const deptStats = await db.select({
    department: departmentReviews.department,
    status: departmentReviews.status,
    count: count()
  }).from(departmentReviews).groupBy(departmentReviews.department, departmentReviews.status);
  const regionStats = await db.select({
    region: projects.bahnhofsmanagement,
    count: count()
  }).from(projects).groupBy(projects.bahnhofsmanagement);
  const prueferWorkload = await db.select({
    name: departmentReviews.prueferName,
    count: count()
  }).from(departmentReviews).where(
    and(
      sql`${departmentReviews.prueferName} IS NOT NULL`,
      sql`${departmentReviews.prueferName} != 'Zuordnung erforderlich'`
    )
  ).groupBy(departmentReviews.prueferName).orderBy(desc(count())).limit(20);
  return {
    totalProjects,
    statusDistribution: statusDist,
    departmentStats: deptStats,
    regionStats,
    prueferWorkload
  };
}
async function getBvbEeaList() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bvbEea).orderBy(desc(bvbEea.id));
}
async function createBvbEea(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(bvbEea).values(data);
  return result[0].insertId;
}
async function updateBvbEea(id, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(bvbEea).set(data).where(eq(bvbEea.id, id));
}
async function getPsvItkList() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(psvItk).orderBy(desc(psvItk.id));
}
async function createPsvItk(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(psvItk).values(data);
  return result[0].insertId;
}
async function updatePsvItk(id, data) {
  const db = await getDb();
  if (!db) return;
  await db.update(psvItk).set(data).where(eq(psvItk.id, id));
}
async function createAuditEntry(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLog).values(data);
}
async function getAuditLog(params) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (params.entityType) conditions.push(eq(auditLog.entityType, params.entityType));
  if (params.entityId) conditions.push(eq(auditLog.entityId, params.entityId));
  const whereClause = conditions.length > 0 ? and(...conditions) : void 0;
  return db.select().from(auditLog).where(whereClause).orderBy(desc(auditLog.createdAt)).limit(params.limit ?? 100);
}
async function getSearchSuggestions(term) {
  const db = await getDb();
  if (!db) return [];
  const searchLike = `${term.replace(/[\\%_]/g, (m2) => `\\${m2}`)}%`;
  const projectSuggestions = await db.selectDistinct({
    value: projects.station,
    type: sql`'station'`
  }).from(projects).where(like(projects.station, searchLike)).union(
    db.selectDistinct({
      value: projects.projektnummer,
      type: sql`'projektnummer'`
    }).from(projects).where(like(projects.projektnummer, searchLike))
  ).union(
    db.selectDistinct({
      value: projects.projektleiter,
      type: sql`'projektleiter'`
    }).from(projects).where(like(projects.projektleiter, searchLike))
  ).union(
    db.selectDistinct({
      value: projects.bahnhofsmanagement,
      type: sql`'region'`
    }).from(projects).where(like(projects.bahnhofsmanagement, searchLike))
  );
  const reviewSuggestions = await db.selectDistinct({
    value: departmentReviews.prueferName,
    type: sql`'pruefer'`
  }).from(departmentReviews).where(like(departmentReviews.prueferName, searchLike)).union(
    db.selectDistinct({
      value: departmentReviews.department,
      type: sql`'department'`
    }).from(departmentReviews).where(like(departmentReviews.department, searchLike))
  );
  const combinedSuggestions = [...projectSuggestions, ...reviewSuggestions].filter((s) => s.value !== null && s.value !== "" && s.value !== "Zuordnung erforderlich").map((s) => s.value);
  return Array.from(new Set(combinedSuggestions)).slice(0, 10);
}
async function getFilterOptions() {
  const db = await getDb();
  if (!db) return { regions: [], projektleiter: [], pruefer: [] };
  const regions = await db.selectDistinct({ value: projects.bahnhofsmanagement }).from(projects).where(sql`${projects.bahnhofsmanagement} IS NOT NULL AND ${projects.bahnhofsmanagement} != ''`).orderBy(asc(projects.bahnhofsmanagement));
  const projektleiterList = await db.selectDistinct({ value: projects.projektleiter }).from(projects).where(sql`${projects.projektleiter} IS NOT NULL AND ${projects.projektleiter} != ''`).orderBy(asc(projects.projektleiter));
  const prueferList = await db.selectDistinct({ value: departmentReviews.prueferName }).from(departmentReviews).where(
    sql`${departmentReviews.prueferName} IS NOT NULL AND ${departmentReviews.prueferName} != '' AND ${departmentReviews.prueferName} != 'Zuordnung erforderlich'`
  ).orderBy(asc(departmentReviews.prueferName));
  return {
    regions: regions.map((r) => r.value).filter(Boolean),
    projektleiter: projektleiterList.map((p) => p.value).filter(Boolean),
    pruefer: prueferList.map((p) => p.value).filter(Boolean)
  };
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    // Lax, not None: the SPA and API are same-site, and SameSite=None would send
    // the session cookie on cross-site requests (CSRF surface) for no benefit.
    sameSite: "lax",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = "/webdev.v1.WebDevAuthPublicService/ExchangeToken";
var GET_USER_INFO_PATH = "/webdev.v1.WebDevAuthPublicService/GetUserInfo";
var GET_USER_INFO_WITH_JWT_PATH = "/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt";
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key2) {
  const value = req.query[key2];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key2 = req.params[0];
    if (!key2) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        `${ENV.forgeApiUrl.replace(/\/+$/, "")}/`
      );
      forgeUrl.searchParams.set("path", key2);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/excel.ts
import * as XLSX from "xlsx";
import { asc as asc2 } from "drizzle-orm";
var DEPARTMENTS2 = [
  "EEA",
  "ITK",
  "BS",
  "GA",
  "Energie",
  "HFT",
  "HKLS",
  "TBQ",
  "UM",
  "BIM",
  "LST",
  "Vermessung",
  "Baubetriebstechnologie",
  "Baubetriebsplanung"
];
function registerExcelRoutes(app) {
  app.get("/api/export/excel", async (_req, res) => {
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const allProjects = await db.select().from(projects).orderBy(asc2(projects.id));
      const allReviews = await db.select().from(departmentReviews);
      const reviewsByProject = {};
      for (const review of allReviews) {
        if (!reviewsByProject[review.projectId]) reviewsByProject[review.projectId] = [];
        reviewsByProject[review.projectId]?.push(review);
      }
      const rows = [];
      for (const project of allProjects) {
        const row = {
          "Projektnummer": project.projektnummer || "",
          "Bahnhofsmanagement": project.bahnhofsmanagement || "",
          "Station": project.station || "",
          "Bahnhofsnummer": project.bahnhofsnummer || "",
          "Streckennummer": project.streckennummer || "",
          "Projektbeschreibung": project.projektbeschreibung || "",
          "Projektstand": project.projektstand || "",
          "Projektleiter": project.projektleiter || "",
          "Termin Projektvorstellung": project.terminProjektvorstellung ? new Date(project.terminProjektvorstellung).toLocaleDateString("de-DE") : ""
        };
        const projectReviews = reviewsByProject[project.id] || [];
        for (const dept of DEPARTMENTS2) {
          const review = projectReviews.find((r) => r.department === dept);
          row[`${dept} - Status`] = review?.status || "";
          row[`${dept} - Pr\xFCfer`] = review?.prueferName || "";
          row[`${dept} - Datum`] = review?.datum ? new Date(review.datum).toLocaleDateString("de-DE") : "";
        }
        row.Kommentar = project.kommentar || "";
        row.Projektlink = project.projektLink || "";
        rows.push(row);
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      const baseCols = [
        { wch: 18 },
        { wch: 16 },
        { wch: 25 },
        { wch: 12 },
        { wch: 12 },
        { wch: 45 },
        { wch: 16 },
        { wch: 25 },
        { wch: 18 }
      ];
      const deptCols = DEPARTMENTS2.flatMap(() => [
        { wch: 18 },
        { wch: 14 },
        { wch: 12 }
      ]);
      ws["!cols"] = [...baseCols, ...deptCols, { wch: 30 }, { wch: 50 }];
      ws["!freeze"] = { x: 0, y: 1 };
      XLSX.utils.book_append_sheet(wb, ws, "\xDCbersicht");
      const legendData = [
        { Info: "This file was exported from Bahn Project Manager" },
        { Info: `Departments (Fachbereiche) in exact Excel column order: ${DEPARTMENTS2.join(", ")}` },
        { Info: `Valid Status values: ${[
          "nicht erforderlich",
          "offen",
          "Projektkonfig.",
          "in Bearbeitung",
          "Nachforderung",
          "pr\xFCff\xE4hig",
          "Pr\xFCfung erfolgt",
          "Zustimmung erteilt",
          "Niederschrift erstellt",
          "abgelehnt",
          "zur\xFCckgestellt",
          "gestoppt"
        ].join(", ")}` },
        { Info: "Date format: DD.MM.YYYY (German)" },
        { Info: "To re-import: Use POST /api/import/excel with this file or the original \xDCbersichtsliste.xlsm (legacy format supported)" }
      ];
      const legendWs = XLSX.utils.json_to_sheet(legendData);
      legendWs["!cols"] = [{ wch: 120 }];
      XLSX.utils.book_append_sheet(wb, legendWs, "Info & Legend");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="Projekt\xFCbersicht_Export.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("[Excel Export] Error:", error);
      res.status(500).json({ error: "Export failed" });
    }
  });
  app.post("/api/import/excel", async (req, res) => {
    try {
      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
      let received = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_IMPORT_BYTES) {
          if (!res.headersSent) res.status(413).json({ error: "File too large (25 MB max)" });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", async () => {
        try {
          const buffer = Buffer.concat(chunks);
          if (buffer.length === 0) {
            res.status(400).json({ error: "Empty file uploaded" });
            return;
          }
          const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: true, raw: false });
          const sheetName = wb.SheetNames[0] ?? "Sheet1";
          const ws = wb.Sheets[sheetName];
          if (!ws) {
            res.status(400).json({ error: "Could not read worksheet from file" });
            return;
          }
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          if (data.length === 0) {
            res.json({ success: true, imported: 0, errors: 0, total: 0, message: "No data rows found" });
            return;
          }
          const headerRow = data[0] || [];
          const isLegacyFormat = headerRow.some(
            (h) => typeof h === "string" && (h === "EEA" || h === "Name" || h === "BS" || h === "Name3" || h.includes("Baubetriebstechnnologie"))
          );
          let imported = 0;
          let errors = 0;
          const errorDetails = [];
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.every((cell) => !cell)) continue;
            try {
              let terminPV = null;
              const terminStr = isLegacyFormat ? row[8] : null;
              if (terminStr) {
                const cleaned = String(terminStr).trim();
                if (typeof terminStr === "number" && terminStr > 4e4) {
                  terminPV = new Date((terminStr - 25569) * 86400 * 1e3);
                } else {
                  const parts = cleaned.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
                  if (parts) {
                    const day = (parts[1] ?? "01").padStart(2, "0");
                    const month = (parts[2] ?? "01").padStart(2, "0");
                    const year = parts[3] ?? "2025";
                    const parsed = /* @__PURE__ */ new Date(`${year}-${month}-${day}`);
                    if (!Number.isNaN(parsed.getTime())) terminPV = parsed;
                  }
                }
              }
              const projectData = {
                projektnummer: row[0] || null,
                bahnhofsmanagement: row[1] || null,
                station: row[2] || null,
                bahnhofsnummer: row[3] || null,
                streckennummer: row[4] || null,
                projektbeschreibung: row[5] || null,
                projektstand: row[6] || null,
                projektleiter: row[7] || null,
                terminProjektvorstellung: terminPV,
                kommentar: row[51] || null,
                projektLink: row[52] || null,
                originalRowIndex: i,
                fullRowData: JSON.stringify(row)
              };
              const [result] = await db.insert(projects).values(projectData);
              const projectId = result.insertId;
              for (const dept of DEPARTMENTS2) {
                let status;
                let name;
                let dateStr;
                if (!isLegacyFormat) {
                  const headerIdx = headerRow.indexOf(`${dept} - Status`);
                  if (headerIdx >= 0) {
                    status = row[headerIdx];
                    name = row[headerIdx + 1];
                    dateStr = row[headerIdx + 2];
                  } else {
                    status = void 0;
                    name = void 0;
                    dateStr = void 0;
                  }
                } else {
                  const legacyMap = {
                    "EEA": { statusCol: 9, prueferCol: 10, datumCol: 11 },
                    "ITK": { statusCol: 12, prueferCol: 13, datumCol: 14 },
                    "BS": { statusCol: 15, prueferCol: 16, datumCol: 17 },
                    "GA": { statusCol: 18, prueferCol: 19, datumCol: 20 },
                    "Energie": { statusCol: 21, prueferCol: 22, datumCol: 23 },
                    "HFT": { statusCol: 24, prueferCol: 25, datumCol: 26 },
                    "HKLS": { statusCol: 27, prueferCol: 28, datumCol: 29 },
                    "TBQ": { statusCol: 30, prueferCol: 31, datumCol: 32 },
                    "UM": { statusCol: 33, prueferCol: 34, datumCol: 35 },
                    "BIM": { statusCol: 36, prueferCol: 37, datumCol: 38 },
                    "LST": { statusCol: 39, prueferCol: 40, datumCol: 41 },
                    "Vermessung": { statusCol: 42, prueferCol: 43, datumCol: 44 },
                    "Baubetriebstechnologie": { statusCol: 45, prueferCol: 46, datumCol: 47 },
                    "Baubetriebsplanung": { statusCol: 48, prueferCol: 49, datumCol: 50 }
                  };
                  const map = legacyMap[dept];
                  if (map) {
                    status = row[map.statusCol];
                    name = row[map.prueferCol];
                    dateStr = row[map.datumCol];
                  }
                }
                if (status || name || dateStr) {
                  let datum = null;
                  if (dateStr) {
                    const cleaned = String(dateStr).trim();
                    if (typeof dateStr === "number" && dateStr > 4e4) {
                      datum = new Date((dateStr - 25569) * 86400 * 1e3);
                    } else {
                      const parts = cleaned.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
                      if (parts) {
                        const day = (parts[1] ?? "01").padStart(2, "0");
                        const month = (parts[2] ?? "01").padStart(2, "0");
                        const year = parts[3] ?? "2025";
                        const parsed = /* @__PURE__ */ new Date(`${year}-${month}-${day}`);
                        if (!Number.isNaN(parsed.getTime())) datum = parsed;
                      }
                    }
                  }
                  await db.insert(departmentReviews).values({
                    projectId,
                    department: dept,
                    prueferName: name || null,
                    datum: datum || null,
                    status: status || null
                  });
                }
              }
              imported++;
            } catch (rowErr) {
              errors++;
              errorDetails.push(`Row ${i}: ${rowErr}`);
              console.error(`[Excel Import] Row ${i} error:`, rowErr);
            }
          }
          res.json({
            success: true,
            imported,
            errors,
            total: data.length - 1,
            formatDetected: isLegacyFormat ? "legacy-\xFCbersichtsliste" : "standard-export",
            errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 5) : void 0
          });
        } catch (parseErr) {
          console.error("[Excel Import] Parse error:", parseErr);
          res.status(400).json({ error: "Invalid Excel file. Make sure it is a valid .xlsx or .xls file." });
        }
      });
      req.on("error", (err) => {
        console.error("[Excel Import] Request stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Upload stream error" });
        }
      });
    } catch (error) {
      console.error("[Excel Import] Error:", error);
      res.status(500).json({ error: "Import failed" });
    }
  });
}

// server/_core/systemRouter.ts
import { z as z2 } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";

// server/domain/errors.ts
var DomainError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
};
var NotFoundError = class extends DomainError {
  constructor(what = "Projekt") {
    super("NOT_FOUND", `${what} nicht gefunden`);
  }
};
var ForbiddenError2 = class extends DomainError {
  constructor(message = "Keine Berechtigung") {
    super("FORBIDDEN", message);
  }
};
var ValidationError = class extends DomainError {
  constructor(message, field) {
    super("VALIDATION", message);
    this.field = field;
  }
};
var IdempotencyKeyReuseError = class extends DomainError {
  constructor() {
    super("IDEMPOTENCY_KEY_REUSE", "Idempotency-Key wurde bereits mit einer anderen Anfrage verwendet");
  }
};
var ConflictError = class extends DomainError {
  constructor(info) {
    super("VERSION_CONFLICT", `Version ${info.expectedVersion} veraltet, aktuell ${info.currentVersion}`);
    this.info = info;
  }
};

// server/observability/metrics.ts
var key = (l) => l ? Object.entries(l).sort().map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(",") : "";
var Counter = class {
  constructor(name, help) {
    this.name = name;
    this.help = help;
  }
  v = /* @__PURE__ */ new Map();
  inc(l, n = 1) {
    const k = key(l);
    this.v.set(k, (this.v.get(k) ?? 0) + n);
  }
  get(l) {
    return this.v.get(key(l)) ?? 0;
  }
  render() {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`, ...[...this.v].map(([k, n]) => `${this.name}${k ? `{${k}}` : ""} ${n}`)];
  }
};
var Gauge = class {
  constructor(name, help) {
    this.name = name;
    this.help = help;
  }
  v = /* @__PURE__ */ new Map();
  set(n, l) {
    this.v.set(key(l), n);
  }
  add(n, l) {
    const k = key(l);
    this.v.set(k, (this.v.get(k) ?? 0) + n);
  }
  get(l) {
    return this.v.get(key(l)) ?? 0;
  }
  render() {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, ...[...this.v].map(([k, n]) => `${this.name}${k ? `{${k}}` : ""} ${n}`)];
  }
};
var BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1e3, 2500, 5e3];
var Histogram = class {
  constructor(name, help, buckets = BUCKETS_MS) {
    this.name = name;
    this.help = help;
    this.buckets = buckets;
  }
  s = /* @__PURE__ */ new Map();
  observe(ms, l) {
    const k = key(l);
    let e = this.s.get(k);
    if (!e) this.s.set(k, e = { b: new Array(this.buckets.length).fill(0), sum: 0, n: 0 });
    for (let i = 0; i < this.buckets.length; i++) if (ms <= this.buckets[i]) e.b[i]++;
    e.sum += ms;
    e.n++;
  }
  /** approximate quantile from bucket upper bounds (conservative: rounds up) */
  quantile(q, l) {
    const e = this.s.get(key(l));
    if (!e || e.n === 0) return null;
    const target = q * e.n;
    for (let i = 0; i < this.buckets.length; i++) if (e.b[i] >= target) return this.buckets[i];
    return Number.POSITIVE_INFINITY;
  }
  render() {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, e] of this.s) {
      const sep = k ? "," : "";
      this.buckets.forEach((b, i) => out.push(`${this.name}_bucket{${k}${sep}le="${b}"} ${e.b[i]}`));
      out.push(`${this.name}_bucket{${k}${sep}le="+Inf"} ${e.n}`, `${this.name}_sum${k ? `{${k}}` : ""} ${e.sum}`, `${this.name}_count${k ? `{${k}}` : ""} ${e.n}`);
    }
    return out;
  }
};
var all = [];
var counter = (n, h) => {
  const c = new Counter(n, h);
  all.push(c);
  return c;
};
var gauge = (n, h) => {
  const g = new Gauge(n, h);
  all.push(g);
  return g;
};
var histogram = (n, h) => {
  const x = new Histogram(n, h);
  all.push(x);
  return x;
};
var renderMetrics = () => all.flatMap((m2) => m2.render()).join("\n") + "\n";
var m = {
  httpMs: histogram("bahn_http_request_ms", "tRPC/HTTP request latency in ms"),
  dbMs: histogram("bahn_db_transaction_ms", "Project write transaction latency in ms"),
  mutations: counter("bahn_mutations_total", "Project mutations by outcome (ok|conflict|replay|error)"),
  conflicts: counter("bahn_conflicts_total", "Version conflicts detected"),
  rtConnections: gauge("bahn_realtime_connections", "Open realtime (SSE) connections on this instance"),
  rtSubscriptions: gauge("bahn_realtime_channel_subscriptions", "Active channel subscriptions on this instance"),
  rtReconnects: counter("bahn_realtime_connects_total", "Realtime connections accepted (reconnects included)"),
  rtErrors: counter("bahn_realtime_gateway_errors_total", "Gateway handler failures answered with 503"),
  unhandled: counter("bahn_unhandled_rejections_total", "Unhandled promise rejections caught by the process-level handler"),
  rtDelivered: counter("bahn_realtime_events_delivered_total", "Events written to subscribers"),
  rtDropped: counter("bahn_realtime_events_dropped_total", "Events dropped for slow consumers (client is told to resync)"),
  rtEventAgeMs: histogram("bahn_realtime_event_age_ms", "Event age (now - envelope.timestamp) when delivered to a subscriber"),
  outboxPublished: counter("bahn_outbox_published_total", "Outbox events published"),
  outboxFailures: counter("bahn_outbox_publish_failures_total", "Outbox publish failures"),
  authVerifyMs: histogram("bahn_auth_verify_ms", "OIDC token verification (signature, claims) in ms"),
  identityMs: histogram("bahn_identity_resolve_ms", "Total identity resolution per request in ms (cache hits included)"),
  shed: counter("bahn_requests_shed_total", "Requests rejected with 429 because the DB pool queue was full"),
  outboxDeadLetters: counter("bahn_outbox_dead_letters_total", "Outbox rows quarantined because they can never be published (alert on > 0)"),
  outboxBacklog: gauge("bahn_outbox_backlog", "Unpublished outbox events (sampled)"),
  poolInUse: gauge("bahn_db_pool_connections_in_use", "DB pool connections in use (sampled)"),
  poolQueued: gauge("bahn_db_pool_queued_requests", "DB pool waiters (sampled)")
};

// server/_core/trpc.ts
var t = initTRPC.context().create({
  transformer: superjson,
  errorFormatter({ shape: shape2, error }) {
    const conflict = error.cause instanceof ConflictError ? error.cause.info : void 0;
    return { ...shape2, data: { ...shape2.data, ...conflict ? { conflict } : {} } };
  }
});
var router = t.router;
var timing = t.middleware(async ({ path: path2, type, next }) => {
  const start = performance.now();
  try {
    return await next();
  } finally {
    m.httpMs.observe(performance.now() - start, { path: path2, type });
  }
});
var domainErrors = t.middleware(async ({ next }) => {
  const res = await next();
  if (!res.ok && /Queue limit reached|Pool is closed|connect ETIMEDOUT/i.test(String(res.error.cause?.message ?? ""))) {
    m.shed.inc();
    throw new TRPCError2({ code: "TOO_MANY_REQUESTS", message: "Server ausgelastet, bitte erneut versuchen", cause: res.error.cause });
  }
  if (!res.ok && res.error.cause instanceof DomainError) {
    const e = res.error.cause;
    const code = e.code === "NOT_FOUND" ? "NOT_FOUND" : e.code === "FORBIDDEN" ? "FORBIDDEN" : e.code === "VERSION_CONFLICT" ? "CONFLICT" : e.code === "IDEMPOTENCY_KEY_REUSE" ? "UNPROCESSABLE_CONTENT" : "BAD_REQUEST";
    throw new TRPCError2({ code, message: e.message, cause: e });
  }
  return res;
});
var publicProcedure = t.procedure.use(timing).use(domainErrors);
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.principal) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      principal: ctx.principal
    }
  });
});
var protectedProcedure = publicProcedure.use(requireUser);
var adminProcedure = publicProcedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (ctx.principal?.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        principal: ctx.principal
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z2.object({
      timestamp: z2.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z2.object({
      title: z2.string().min(1, "title is required"),
      content: z2.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z6 } from "zod";

// shared/server/odata.ts
import { z as z3 } from "zod";
var ODataQuerySchema = z3.object({
  $filter: z3.string().optional(),
  $select: z3.string().optional(),
  $expand: z3.string().optional(),
  // e.g. "reviews"
  $orderby: z3.string().optional(),
  $top: z3.coerce.number().int().positive().max(1e3).optional(),
  $skip: z3.coerce.number().int().nonnegative().optional(),
  $count: z3.coerce.boolean().optional(),
  $search: z3.string().optional()
});
function parseODataFilter(filter) {
  if (!filter) return {};
  const result = {};
  const andParts = filter.split(" and ");
  for (const part of andParts) {
    const eqMatch = part.match(/(\w+)\s+eq\s+'?([^']+)'?/);
    if (eqMatch?.[1] && eqMatch[2]) {
      result[eqMatch[1]] = eqMatch[2];
    }
    const containsMatch = part.match(/contains\((\w+),\s*'([^']+)'\)/);
    if (containsMatch?.[1] && containsMatch[2]) {
      result[`${containsMatch[1]}_contains`] = containsMatch[2];
    }
  }
  return result;
}

// shared/project-contract.ts
import { z as z4 } from "zod";
var EDITABLE_PROJECT_FIELDS = [
  "projektnummer",
  "bahnhofsmanagement",
  "station",
  "bahnhofsnummer",
  "streckennummer",
  "projektbeschreibung",
  "projektstand",
  "eigvEinstufung",
  "projektleiter",
  "terminProjektvorstellung",
  "kommentar",
  "projektLink"
];
var shape = ProjectSchema.shape;
var ProjectFieldsSchema = z4.object({
  projektnummer: shape.projektnummer,
  bahnhofsmanagement: shape.bahnhofsmanagement,
  station: shape.station,
  bahnhofsnummer: shape.bahnhofsnummer,
  streckennummer: shape.streckennummer,
  projektbeschreibung: shape.projektbeschreibung,
  projektstand: shape.projektstand,
  eigvEinstufung: shape.eigvEinstufung,
  projektleiter: shape.projektleiter,
  terminProjektvorstellung: shape.terminProjektvorstellung,
  kommentar: shape.kommentar,
  projektLink: shape.projektLink
});
var ProjectPatchSchema = ProjectFieldsSchema.partial().strict();
var idempotencyKey = z4.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
var UpdateProjectInputSchema = z4.object({
  id: z4.number().int().positive(),
  /** the version the client's edit was based on */
  expectedVersion: z4.number().int().min(1),
  changes: ProjectPatchSchema.refine((p) => Object.keys(p).length > 0, "changes must not be empty"),
  idempotencyKey,
  /** client-generated, echoed in logs/traces to correlate one user action */
  mutationId: z4.string().max(64).optional()
});
var reviewChangeKey = (department, field) => `review.${department}.${field}`;
var REVIEW_KEY_RE = /^review\.([^.]+)\.(status|prueferName|datum)$/;
var UpdateReviewInputSchema = z4.object({
  projectId: z4.number().int().positive(),
  department: z4.string().min(1).max(64),
  /** the PROJECT version: a review is part of the Project aggregate */
  expectedVersion: z4.number().int().min(1),
  changes: z4.object({
    status: z4.string().max(128).nullable().optional(),
    prueferName: z4.string().max(256).nullable().optional(),
    datum: z4.string().max(40).nullable().optional()
  }).strict().refine((p) => Object.keys(p).length > 0, "changes must not be empty"),
  idempotencyKey,
  mutationId: z4.string().max(64).optional()
});
var CreateProjectInputSchema = z4.object({
  fields: ProjectPatchSchema,
  idempotencyKey,
  mutationId: z4.string().max(64).optional()
});
var PROJECT_SORTS = ["updatedAt", "id", "projektnummer", "station", "projektstand", "projektleiter", "bahnhofsmanagement"];
var MAX_PAGE_SIZE = 100;
var DEFAULT_PAGE_SIZE = 50;
var ListProjectsInputSchema = z4.object({
  cursor: z4.string().max(256).optional(),
  limit: z4.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z4.enum(PROJECT_SORTS).default("updatedAt"),
  dir: z4.enum(["asc", "desc"]).default("desc"),
  search: z4.string().trim().max(100).optional(),
  bahnhofsmanagement: z4.string().max(128).optional(),
  projektstand: z4.string().max(256).optional(),
  projektleiter: z4.string().max(256).optional(),
  /** review-based filters (EXISTS on department_reviews) */
  department: z4.string().max(64).optional(),
  reviewStatus: z4.string().max(128).optional(),
  pruefer: z4.string().max(256).optional(),
  /** optional detail expansion; the default row is the lean summary */
  expand: z4.array(z4.enum(["reviews", "details"])).max(2).default([]),
  includeTotal: z4.boolean().default(false)
});
var SyncInputSchema = z4.object({
  /** projects the client holds → the version it holds. Bounded. */
  known: z4.array(z4.object({ id: z4.number().int().positive(), version: z4.number().int().min(1) })).max(200)
});

// server/domain/projectService.ts
import { createHash, randomUUID } from "node:crypto";

// shared/ingest.ts
var PLACEHOLDER_TOKENS = /* @__PURE__ */ new Set([
  "",
  "-",
  "--",
  "?",
  "??",
  "???",
  "n/a",
  "na",
  "null",
  "undefined",
  "bitte ausw\xE4hlen",
  "bitte ausf\xFCllen"
]);
function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_TOKENS.has(s.toLowerCase())) return null;
  return s;
}

// shared/domain-events.ts
import { z as z5 } from "zod";
var EVENT_SCHEMA_VERSION = 1;
var AGGREGATE_TYPES = ["project", "presence", "notification"];
var EVENT_TYPES = [
  "project.created",
  "project.updated",
  "project.deleted",
  /**
   * Recipient-safe form of a workspace move, sent ONLY to principals who could see the
   * project before the move but not after: it carries no field values.
   */
  "project.removed",
  /** ephemeral: a full snapshot of who is present in `aggregateId` (a scope key) */
  "presence.changed",
  /** a user notification; `context.recipient` is the only principal that may receive it */
  "notification.created"
];
var FieldChangeSchema = z5.object({
  from: z5.string().nullable(),
  to: z5.string().nullable()
});
var DomainEventSchema = z5.object({
  schemaVersion: z5.literal(EVENT_SCHEMA_VERSION),
  eventId: z5.string().uuid(),
  /** position in the change feed; set by the outbox relay, absent on unpublished rows */
  feedSeq: z5.number().int().positive().optional(),
  eventType: z5.enum(EVENT_TYPES),
  aggregateType: z5.enum(AGGREGATE_TYPES),
  /** string on the wire so the contract survives a change of key type */
  aggregateId: z5.string().min(1).max(64),
  aggregateVersion: z5.number().int().min(1),
  actorId: z5.string().min(1).max(64),
  /** display only; never used for authorization */
  actorName: z5.string().max(256).nullable().optional(),
  timestamp: z5.string().datetime({ offset: true }),
  traceId: z5.string().min(1).max(64),
  /** fieldName → {from,to}. Empty for project.deleted. */
  changes: z5.record(z5.string(), FieldChangeSchema),
  /**
   * Routing context, derived from the aggregate AFTER the change. Scopes are
   * computed from this by scopesForEvent(); it is data, not a delivery list.
   */
  context: z5.object({
    workspace: z5.string().nullable().optional(),
    workspaceBefore: z5.string().nullable().optional(),
    /** notification.created: principal id of the sole recipient */
    recipient: z5.string().max(64).optional()
  }).optional()
});
function slugify(value) {
  return value.replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
var scope = {
  project: (id) => `project:${id}`,
  workspace: (name) => `workspace:${slugify(name)}`,
  department: (code) => `department:${code.toUpperCase()}`,
  user: (id) => `user:${id}`,
  notifications: (id) => `notifications:${id}`
};
var SCOPE_RE = /^(workspace|department|project|user|notifications):[A-Za-z0-9_.-]{1,64}$/;
var isValidScope = (s) => SCOPE_RE.test(s);
function scopesForEvent(event) {
  const out = /* @__PURE__ */ new Set();
  if (event.aggregateType === "presence") return isValidScope(event.aggregateId) ? [event.aggregateId] : [];
  if (event.aggregateType === "notification") return event.context?.recipient ? [scope.notifications(event.context.recipient)] : [];
  if (event.aggregateType === "project") {
    out.add(scope.project(event.aggregateId));
    const ws = event.context?.workspace;
    const before = event.context?.workspaceBefore;
    if (ws) out.add(scope.workspace(ws));
    if (before) out.add(scope.workspace(before));
  }
  return [...out];
}
var SeenEvents = class {
  constructor(capacity = 2048) {
    this.capacity = capacity;
  }
  ids = /* @__PURE__ */ new Set();
  /** returns true when the id was already present */
  seen(eventId) {
    if (this.ids.has(eventId)) return true;
    this.ids.add(eventId);
    if (this.ids.size > this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest !== void 0) this.ids.delete(oldest);
    }
    return false;
  }
};

// server/infra/mysqlProjectStore.ts
import { and as and2, asc as asc3, desc as desc2, eq as eq2, gt, inArray as inArray2, lt, lte, or as or2, sql as sql2 } from "drizzle-orm";
var iso = (d) => d ? d.toISOString() : null;
function dateToWire(d) {
  if (!d) return null;
  const s = d.toISOString();
  return s.endsWith("T00:00:00.000Z") ? s.slice(0, 10) : s;
}
var SUMMARY_COLUMNS = {
  id: projects.id,
  syncVersion: projects.syncVersion,
  projektnummer: projects.projektnummer,
  bahnhofsmanagement: projects.bahnhofsmanagement,
  station: projects.station,
  projektstand: projects.projektstand,
  projektleiter: projects.projektleiter,
  terminProjektvorstellung: projects.terminProjektvorstellung,
  updatedAt: projects.updatedAt
};
var DETAIL_COLUMNS = {
  bahnhofsnummer: projects.bahnhofsnummer,
  streckennummer: projects.streckennummer,
  projektbeschreibung: projects.projektbeschreibung,
  eigvEinstufung: projects.eigvEinstufung,
  kommentar: projects.kommentar,
  projektLink: projects.projektLink,
  createdAt: projects.createdAt
};
function toSummary(p) {
  return {
    id: p.id,
    version: p.syncVersion,
    projektnummer: p.projektnummer,
    bahnhofsmanagement: p.bahnhofsmanagement,
    station: p.station,
    projektstand: p.projektstand,
    projektleiter: p.projektleiter,
    terminProjektvorstellung: dateToWire(p.terminProjektvorstellung),
    updatedAt: p.updatedAt.toISOString()
  };
}
async function loadDetail(x, id) {
  const rows = await x.select().from(projects).where(eq2(projects.id, id)).limit(1);
  const p = rows[0];
  if (!p) return null;
  const reviews = await x.select().from(departmentReviews).where(eq2(departmentReviews.projectId, id)).orderBy(asc3(departmentReviews.department));
  return {
    ...toSummary(p),
    bahnhofsnummer: p.bahnhofsnummer,
    streckennummer: p.streckennummer,
    projektbeschreibung: p.projektbeschreibung,
    eigvEinstufung: p.eigvEinstufung,
    kommentar: p.kommentar,
    projektLink: p.projektLink,
    createdAt: p.createdAt.toISOString(),
    reviews: reviews.map((r) => ({
      id: r.id,
      department: r.department,
      prueferName: r.prueferName,
      datum: dateToWire(r.datum),
      status: r.status,
      updatedAt: r.updatedAt.toISOString()
    }))
  };
}
var parseEnvelope = (raw) => DomainEventSchema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
async function loadEventsSince(x, aggregateId, after, limit) {
  const rows = await x.select({ envelope: domainEvents.envelope }).from(domainEvents).where(
    and2(
      eq2(domainEvents.aggregateType, "project"),
      eq2(domainEvents.aggregateId, aggregateId),
      gt(domainEvents.aggregateVersion, after)
    )
  ).orderBy(asc3(domainEvents.aggregateVersion)).limit(limit);
  return rows.map((r) => parseEnvelope(r.envelope));
}
function txAdapter(x) {
  return {
    async lockProject(id) {
      const rows = await x.select().from(projects).where(eq2(projects.id, id)).limit(1).for("update");
      return rows[0] ?? null;
    },
    async updateVersioned(id, expectedVersion, set) {
      const [res] = await x.update(projects).set({ ...set, syncVersion: expectedVersion + 1 }).where(and2(eq2(projects.id, id), eq2(projects.syncVersion, expectedVersion)));
      return res.affectedRows === 1;
    },
    async insertProject(values) {
      const [res] = await x.insert(projects).values({ ...values, syncVersion: 1 });
      return Number(res.insertId);
    },
    async deleteProject(id) {
      await x.delete(departmentReviews).where(eq2(departmentReviews.projectId, id));
      await x.delete(projectWatchers).where(eq2(projectWatchers.projectId, id));
      await x.delete(projects).where(eq2(projects.id, id));
    },
    async watchersOf(projectId) {
      const rows = await x.select({ u: projectWatchers.userId }).from(projectWatchers).where(eq2(projectWatchers.projectId, projectId));
      return rows.map((r) => r.u);
    },
    async insertNotification(row) {
      const [res] = await x.insert(notifications).values({ ...row, kind: row.kind, createdAt: /* @__PURE__ */ new Date() });
      return Number(res.insertId);
    },
    async lockReview(projectId, department) {
      const rows = await x.select().from(departmentReviews).where(and2(eq2(departmentReviews.projectId, projectId), eq2(departmentReviews.department, department))).limit(1).for("update");
      const r = rows[0];
      return r ? { id: r.id, status: r.status, prueferName: r.prueferName, datum: r.datum } : null;
    },
    async updateReview(id, set) {
      await x.update(departmentReviews).set(set).where(eq2(departmentReviews.id, id));
    },
    detail: (id) => loadDetail(x, id),
    async appendAudit(rows) {
      if (rows.length) await x.insert(auditLog).values(rows);
    },
    async appendEvent(e) {
      await x.insert(domainEvents).values({
        eventId: e.eventId,
        eventType: e.eventType,
        aggregateType: e.aggregateType,
        aggregateId: Number(e.aggregateId),
        aggregateVersion: e.aggregateVersion,
        envelope: e,
        createdAt: new Date(e.timestamp)
      });
    },
    eventsSince: (id, after, limit) => loadEventsSince(x, id, after, limit),
    async claimIdempotency(actorId, key2, operation, requestHash2) {
      const [res] = await x.insert(idempotencyKeys).ignore().values({ actorId, idempotencyKey: key2, operation, requestHash: requestHash2, response: null, createdAt: /* @__PURE__ */ new Date() });
      if (res.affectedRows === 1) return { state: "new" };
      const [rows] = await x.execute(
        sql2`SELECT requestHash, operation, response FROM idempotency_keys WHERE actorId = ${actorId} AND idempotencyKey = ${key2} LIMIT 1 LOCK IN SHARE MODE`
      );
      const row = rows[0];
      if (!row || row.requestHash !== requestHash2 || row.operation !== operation) return { state: "mismatch" };
      const response = typeof row.response === "string" ? JSON.parse(row.response) : row.response;
      return { state: "replay", response };
    },
    async completeIdempotency(actorId, key2, response) {
      await x.update(idempotencyKeys).set({ response }).where(and2(eq2(idempotencyKeys.actorId, actorId), eq2(idempotencyKeys.idempotencyKey, key2)));
    }
  };
}
function fulltextQuery(search) {
  const tokens = search.replace(/[+\-<>()~*"@]/g, " ").split(/\s+/).filter(Boolean);
  const indexable = tokens.filter((t2) => t2.length >= 3);
  return {
    boolean: indexable.length ? indexable.map((t2) => `+${t2}*`).join(" ") : null,
    prefix: tokens.join(" ")
  };
}
var encodeCursor = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function decodeCursor(c) {
  try {
    const o = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (typeof o?.id === "number" && (typeof o.v === "string" || typeof o.v === "number")) return o;
  } catch {
  }
  return null;
}
function isDeadlock(err) {
  for (let e = err; e; e = e.cause) if (e.errno === 1213 || e.code === "ER_LOCK_DEADLOCK") return true;
  return false;
}
var MysqlProjectStore = class {
  constructor(db) {
    this.db = db;
  }
  /**
   * Runs fn in one transaction. A deadlock victim is rolled back in full by
   * the server, so re-running fn from the top is safe; bounded to 3 attempts.
   */
  async transaction(fn) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction((t2) => fn(txAdapter(t2)));
      } catch (err) {
        if (attempt < 3 && isDeadlock(err)) continue;
        throw err;
      }
    }
  }
  detail(id) {
    return loadDetail(this.db, id);
  }
  eventsSince(aggregateId, afterVersion, limit) {
    return loadEventsSince(this.db, aggregateId, afterVersion, limit);
  }
  async versions(ids) {
    const out = /* @__PURE__ */ new Map();
    if (!ids.length) return out;
    const rows = await this.db.select({ id: projects.id, v: projects.syncVersion, bm: projects.bahnhofsmanagement }).from(projects).where(inArray2(projects.id, ids));
    for (const r of rows) out.set(r.id, { version: r.v, bahnhofsmanagement: r.bm });
    return out;
  }
  // ---- notifications & watching (reads/writes outside the mutation transaction) ----------------
  async watch(projectId, userId) {
    await this.db.insert(projectWatchers).ignore().values({ projectId, userId, createdAt: /* @__PURE__ */ new Date() });
  }
  async unwatch(projectId, userId) {
    await this.db.delete(projectWatchers).where(and2(eq2(projectWatchers.projectId, projectId), eq2(projectWatchers.userId, userId)));
  }
  async isWatching(projectId, userId) {
    const r = await this.db.select({ n: sql2`1` }).from(projectWatchers).where(and2(eq2(projectWatchers.projectId, projectId), eq2(projectWatchers.userId, userId))).limit(1);
    return r.length > 0;
  }
  /** Newest first, keyset on id. `workspaces`: null = unrestricted; a list re-checks the recipient's CURRENT access. */
  async listNotifications(userId, o, workspaces) {
    if (workspaces !== null && workspaces.length === 0) return { items: [], nextCursor: null };
    const conds = [eq2(notifications.userId, userId)];
    if (o.cursor) conds.push(lt(notifications.id, o.cursor));
    if (o.unreadOnly) conds.push(sql2`${notifications.readAt} IS NULL`);
    if (workspaces !== null) conds.push(inArray2(notifications.workspace, [...workspaces]));
    const rows = await this.db.select().from(notifications).where(and2(...conds)).orderBy(desc2(notifications.id)).limit(o.limit + 1);
    const page = rows.slice(0, o.limit);
    return {
      items: page.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.createdAt.toISOString(), read: r.readAt !== null })),
      nextCursor: rows.length > o.limit ? page[page.length - 1].id : null
    };
  }
  async unreadCount(userId, workspaces) {
    if (workspaces !== null && workspaces.length === 0) return 0;
    const conds = [eq2(notifications.userId, userId), sql2`${notifications.readAt} IS NULL`];
    if (workspaces !== null) conds.push(inArray2(notifications.workspace, [...workspaces]));
    const [r] = await this.db.select({ n: sql2`COUNT(*)` }).from(notifications).where(and2(...conds));
    return Number(r?.n ?? 0);
  }
  async markRead(userId, ids) {
    const cond = ids === "all" ? eq2(notifications.userId, userId) : and2(eq2(notifications.userId, userId), inArray2(notifications.id, ids));
    await this.db.update(notifications).set({ readAt: /* @__PURE__ */ new Date() }).where(and2(cond, sql2`${notifications.readAt} IS NULL`));
  }
  async filterOptions(workspaces) {
    if (workspaces.length === 0) return { regions: [], projektleiter: [], pruefer: [] };
    const bm = inArray2(projects.bahnhofsmanagement, [...workspaces]);
    const leaders = await this.db.selectDistinct({ v: projects.projektleiter }).from(projects).where(and2(bm, sql2`${projects.projektleiter} IS NOT NULL AND ${projects.projektleiter} != ''`)).orderBy(asc3(projects.projektleiter));
    const pruefer = await this.db.selectDistinct({ v: departmentReviews.prueferName }).from(departmentReviews).innerJoin(projects, eq2(projects.id, departmentReviews.projectId)).where(and2(bm, sql2`${departmentReviews.prueferName} IS NOT NULL AND ${departmentReviews.prueferName} != '' AND ${departmentReviews.prueferName} != 'Zuordnung erforderlich'`)).orderBy(asc3(departmentReviews.prueferName));
    return { regions: [...workspaces], projektleiter: leaders.map((l) => l.v).filter(Boolean), pruefer: pruefer.map((l) => l.v).filter(Boolean) };
  }
  async feedHead() {
    const [row] = await this.db.select({ h: sql2`COALESCE(MAX(${domainEvents.feedSeq}), 0)` }).from(domainEvents);
    return Number(row?.h ?? 0);
  }
  async changesSince(after, limit, upTo) {
    const rows = await this.db.select({ envelope: domainEvents.envelope, feedSeq: domainEvents.feedSeq }).from(domainEvents).where(and2(gt(domainEvents.feedSeq, after), ...upTo !== void 0 ? [lte(domainEvents.feedSeq, upTo)] : [])).orderBy(asc3(domainEvents.feedSeq)).limit(limit);
    return rows.map((r) => ({ ...parseEnvelope(r.envelope), feedSeq: Number(r.feedSeq) }));
  }
  async shellSummary() {
    const [row] = await this.db.select({ n: sql2`COUNT(*)`, last: sql2`MAX(${projects.updatedAt})` }).from(projects);
    return { projectCount: Number(row?.n ?? 0), lastUpdatedAt: iso(row?.last ? new Date(row.last) : null) };
  }
  async list(input, visibility, opts = {}) {
    const limit = Math.min(input.limit, MAX_PAGE_SIZE);
    const conds = [];
    if (visibility.workspaces !== null && visibility.workspaces.length === 0) return { items: [], nextCursor: null, ...input.includeTotal ? { total: 0 } : {} };
    if (visibility.workspaces !== null) conds.push(inArray2(projects.bahnhofsmanagement, [...visibility.workspaces]));
    if (input.bahnhofsmanagement) conds.push(eq2(projects.bahnhofsmanagement, input.bahnhofsmanagement));
    if (input.projektstand) conds.push(eq2(projects.projektstand, input.projektstand));
    if (input.projektleiter) conds.push(eq2(projects.projektleiter, input.projektleiter));
    if (opts.stationPrefix) {
      const like2 = `${opts.stationPrefix.replace(/[\\%_]/g, (m2) => `\\${m2}`)}%`;
      conds.push(sql2`${projects.station} LIKE ${like2}`);
    }
    if (input.search) {
      const { boolean, prefix } = fulltextQuery(input.search);
      if (boolean) {
        conds.push(
          sql2`MATCH(${projects.projektnummer}, ${projects.station}, ${projects.projektbeschreibung}, ${projects.projektleiter}) AGAINST (${boolean} IN BOOLEAN MODE)`
        );
      } else if (prefix) {
        const like2 = `${prefix.replace(/[\\%_]/g, (m2) => `\\${m2}`)}%`;
        conds.push(or2(sql2`${projects.projektnummer} LIKE ${like2}`, sql2`${projects.station} LIKE ${like2}`));
      }
    }
    const reviewConds = [];
    if (input.department) reviewConds.push(sql2`r.department = ${input.department}`);
    if (input.reviewStatus) reviewConds.push(sql2`r.status = ${input.reviewStatus}`);
    if (input.pruefer) reviewConds.push(sql2`r.prueferName = ${input.pruefer}`);
    if (reviewConds.length) {
      conds.push(sql2`EXISTS (SELECT 1 FROM department_reviews r WHERE r.projectId = ${projects.id} AND ${sql2.join(reviewConds, sql2` AND `)})`);
    }
    const desc_ = input.dir === "desc";
    const textCol = {
      projektnummer: projects.projektnummer,
      station: projects.station,
      projektstand: projects.projektstand,
      projektleiter: projects.projektleiter,
      bahnhofsmanagement: projects.bahnhofsmanagement
    }[input.sort];
    const sortExpr = textCol ? sql2`COALESCE(${textCol}, '')` : input.sort === "id" ? sql2`${projects.id}` : sql2`${projects.updatedAt}`;
    const dirFn = desc_ ? desc2 : asc3;
    const order = input.sort === "id" ? [dirFn(projects.id)] : [dirFn(sortExpr), dirFn(projects.id)];
    const total = input.includeTotal ? Number(
      (await this.db.select({ n: sql2`COUNT(*)` }).from(projects).where(conds.length ? and2(...conds) : void 0))[0]?.n ?? 0
    ) : void 0;
    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      if (c) {
        const cmp = desc_ ? lt : gt;
        if (input.sort === "id") {
          conds.push(cmp(projects.id, c.id));
        } else {
          const at = input.sort === "updatedAt" ? new Date(String(c.v)) : String(c.v);
          conds.push(or2(cmp(sortExpr, at), and2(eq2(sortExpr, at), cmp(projects.id, c.id))));
        }
      }
    }
    const wantDetails = input.expand.includes("details");
    const rows = await this.db.select(wantDetails ? { ...SUMMARY_COLUMNS, ...DETAIL_COLUMNS } : SUMMARY_COLUMNS).from(projects).where(conds.length ? and2(...conds) : void 0).orderBy(...order).limit(limit + 1).offset(opts.offset ?? 0);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const cursorValue = (r) => input.sort === "id" ? r.id : input.sort === "updatedAt" ? r.updatedAt.toISOString() : String(r[input.sort] ?? "");
    const nextCursor = rows.length > limit && last ? encodeCursor({ v: cursorValue(last), id: last.id }) : null;
    let reviewsById = null;
    if (input.expand.includes("reviews") && page.length) {
      reviewsById = /* @__PURE__ */ new Map();
      const rr = await this.db.select().from(departmentReviews).where(inArray2(departmentReviews.projectId, page.map((p) => p.id))).orderBy(asc3(departmentReviews.department));
      for (const r of rr) {
        const list = reviewsById.get(r.projectId) ?? [];
        list.push({ id: r.id, department: r.department, prueferName: r.prueferName, datum: dateToWire(r.datum), status: r.status, updatedAt: r.updatedAt.toISOString() });
        reviewsById.set(r.projectId, list);
      }
    }
    const items = page.map((r) => {
      const item = toSummary(r);
      if (wantDetails) {
        const d = r;
        Object.assign(item, {
          bahnhofsnummer: d.bahnhofsnummer,
          streckennummer: d.streckennummer,
          projektbeschreibung: d.projektbeschreibung,
          eigvEinstufung: d.eigvEinstufung,
          kommentar: d.kommentar,
          projektLink: d.projektLink,
          createdAt: d.createdAt.toISOString()
        });
      }
      if (reviewsById) item.reviews = reviewsById.get(r.id) ?? [];
      return item;
    });
    return { items, nextCursor, ...total !== void 0 ? { total } : {} };
  }
};

// server/domain/permissions.ts
function workspaceRestriction(p) {
  if (p.role === "admin" || p.workspaces === "ALL") return null;
  return p.workspaces;
}
var inWorkspaces = (p, ws) => {
  const allowed = workspaceRestriction(p);
  return allowed === null || ws !== null && allowed.some((w) => slugify(w) === slugify(ws));
};
var isAdmin = (p) => p.role === "admin";
var canWriteRole = (p) => p.role === "admin" || p.role === "editor";
function canViewProject(p, project) {
  return isAdmin(p) || inWorkspaces(p, project.bahnhofsmanagement);
}
function canEditProject(p, project) {
  return canWriteRole(p) && canViewProject(p, project);
}
function canCreateProject(p, target) {
  return canEditProject(p, target);
}
function canEditDepartment(p, department) {
  return isAdmin(p) || p.role === "editor" && p.departments.some((d) => d.toUpperCase() === department.toUpperCase());
}
function canApproveReview(p, project, department) {
  return canViewProject(p, project) && canEditDepartment(p, department);
}
function canDeleteProject(p, _project) {
  return isAdmin(p);
}
function canViewAudit(p) {
  return canWriteRole(p);
}
function canExport(p) {
  return canWriteRole(p);
}
function canSubscribe(p, scopeKey) {
  const idx = scopeKey.indexOf(":");
  const kind = scopeKey.slice(0, idx);
  const id = scopeKey.slice(idx + 1);
  switch (kind) {
    case "user":
    case "notifications":
      return id === p.id || isAdmin(p);
    case "workspace": {
      const allowed = workspaceRestriction(p);
      return allowed === null || allowed.some((w) => slugify(w) === id);
    }
    case "department":
      return isAdmin(p) || p.departments.some((d) => d.toUpperCase() === id.toUpperCase());
    case "project":
      return true;
    default:
      return false;
  }
}
function roleFromLegacy(legacy) {
  if (legacy === "admin") return "admin";
  if (legacy === "user") return "editor";
  return "viewer";
}

// server/domain/eventVisibility.ts
var HIDDEN_WORKSPACE = "*";
function eventForPrincipal(p, e) {
  if (e.aggregateType === "notification") {
    return e.context?.recipient === p.id && canViewProject(p, { bahnhofsmanagement: e.context?.workspace ?? null }) ? e : null;
  }
  if (e.aggregateType === "presence") {
    if (!canSubscribe(p, e.aggregateId)) return null;
    if (e.aggregateId.startsWith("project:")) return canViewProject(p, { bahnhofsmanagement: e.context?.workspace ?? null }) ? e : null;
    return e;
  }
  if (e.aggregateType !== "project") return null;
  const now = e.context?.workspace ?? null;
  const before = e.context?.workspaceBefore ?? null;
  const sees = (ws) => canViewProject(p, { bahnhofsmanagement: ws });
  if (e.eventType === "project.removed") return sees(before) ? e : null;
  if (e.eventType === "project.deleted") return sees(now) || before !== null && sees(before) ? e : null;
  const seesNow = sees(now);
  if (before === null) return seesNow ? e : null;
  const seesBefore = sees(before);
  if (seesNow && seesBefore) return e;
  if (seesNow) {
    return {
      ...e,
      changes: Object.fromEntries(Object.entries(e.changes).map(([f, c]) => [f, { from: null, to: c.to }])),
      context: { ...e.context, workspaceBefore: HIDDEN_WORKSPACE }
    };
  }
  if (seesBefore) {
    return {
      schemaVersion: e.schemaVersion,
      eventId: e.eventId,
      ...e.feedSeq !== void 0 ? { feedSeq: e.feedSeq } : {},
      eventType: "project.removed",
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      aggregateVersion: e.aggregateVersion,
      actorId: "redacted",
      actorName: null,
      timestamp: e.timestamp,
      traceId: e.traceId,
      changes: {},
      context: { workspace: null, workspaceBefore: before }
    };
  }
  return null;
}

// server/domain/notificationPolicy.ts
var BLOCKING = /(gestoppt|gestopp|stopp|abgelehnt)/i;
var show = (v) => v === null || v === "" ? "leer" : v;
function planNotification(e, project) {
  if (e.aggregateType !== "project") return null;
  const label = project.station || project.projektnummer || `Projekt ${project.id}`;
  const link = `/projects?projekt=${project.id}`;
  const actor = e.actorName ?? "Jemand";
  if (e.eventType === "project.deleted") {
    return { kind: "critical", title: `${label}: Projekt gel\xF6scht`, body: `${actor} hat das Projekt gel\xF6scht.`, link: "/projects" };
  }
  if (e.eventType !== "project.updated") return null;
  const lines = [];
  let kind = null;
  const bump = (k) => {
    const rank = ["system", "workflow", "mention", "assignment", "deadline", "critical"];
    if (kind === null || rank.indexOf(k) > rank.indexOf(kind)) kind = k;
  };
  for (const [key2, c] of Object.entries(e.changes)) {
    const r = REVIEW_KEY_RE.exec(key2);
    if (r) {
      const [, dept, field] = r;
      if (field === "status") {
        lines.push(`${dept}: ${show(c.from)} \u2192 ${show(c.to)}`);
        bump(c.to && BLOCKING.test(c.to) ? "critical" : "workflow");
      } else if (field === "prueferName") {
        lines.push(`${dept}-Pr\xFCfer: ${show(c.from)} \u2192 ${show(c.to)}`);
        bump("assignment");
      }
      continue;
    }
    switch (key2) {
      case "projektstand":
        lines.push(`Projektstand: ${show(c.from)} \u2192 ${show(c.to)}`);
        bump(c.to && BLOCKING.test(c.to) ? "critical" : "workflow");
        break;
      case "projektleiter":
        lines.push(`Projektleitung: ${show(c.from)} \u2192 ${show(c.to)}`);
        bump("assignment");
        break;
      case "terminProjektvorstellung":
        lines.push(`Termin Projektvorstellung: ${show(c.from)} \u2192 ${show(c.to)}`);
        bump("deadline");
        break;
    }
  }
  if (!kind || lines.length === 0) return null;
  return { kind, title: `${label}: ${lines[0]}`, body: `${actor}${lines.length > 1 ? ` \xB7 ${lines.length} \xC4nderungen: ${lines.join("; ")}` : ""}`.slice(0, 1e3), link };
}

// server/domain/projectService.ts
var DATE_FIELDS = /* @__PURE__ */ new Set(["terminProjektvorstellung"]);
var MAX_REPLAY_EVENTS = 25;
function normalizePatch(patch) {
  const out = {};
  for (const field of EDITABLE_PROJECT_FIELDS) {
    if (!(field in patch)) continue;
    const raw = patch[field];
    if (field === "bahnhofsmanagement") {
      const n = normalizeBahnhofsmanagement(raw);
      if (raw != null && cleanStr(raw) !== null && n.value === null) {
        throw new ValidationError(`Unbekanntes Bahnhofsmanagement: "${raw}"`, field);
      }
      out[field] = n.value;
    } else if (DATE_FIELDS.has(field)) {
      const c = cleanStr(raw);
      if (c === null) {
        out[field] = null;
        continue;
      }
      const d = new Date(c);
      if (Number.isNaN(d.getTime())) throw new ValidationError(`Ung\xFCltiges Datum: "${raw}"`, field);
      out[field] = dateToWire(d);
    } else {
      out[field] = cleanStr(raw);
    }
  }
  return out;
}
function currentWire(p, field) {
  const v = p[field];
  return v instanceof Date ? dateToWire(v) : v ?? null;
}
function toColumnValues(norm) {
  const set = {};
  for (const [k, v] of Object.entries(norm)) {
    set[k] = DATE_FIELDS.has(k) ? v === null ? null : new Date(v) : v;
  }
  return set;
}
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
var requestHash = (op, body) => createHash("sha256").update(op).update("\0").update(stableStringify(body)).digest("hex");
var actorNumericId = (p) => /^\d+$/.test(p.id) ? Number(p.id) : null;
function diffOf(current, norm) {
  const changes = {};
  for (const [field, to] of Object.entries(norm)) {
    const from = currentWire(current, field);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}
var ProjectService = class {
  constructor(store, afterCommit = () => {
  }, clock = () => /* @__PURE__ */ new Date()) {
    this.store = store;
    this.afterCommit = afterCommit;
    this.clock = clock;
  }
  // ---- reads --------------------------------------------------------------
  async get(principal, id) {
    const d = await this.store.detail(id);
    if (!d || !canViewProject(principal, { bahnhofsmanagement: d.bahnhofsmanagement })) throw new NotFoundError();
    return d;
  }
  /**
   * Reconnect recovery. For each project the client holds, return the missed
   * events (contiguous, so the client can apply them in order), or a fresh
   * snapshot when too many were missed, or a deletion marker.
   */
  async sync(principal, known) {
    const versions = await this.store.versions(known.map((k) => k.id));
    const events = [];
    const snapshots = [];
    const deleted = [];
    for (const k of known) {
      const cur = versions.get(k.id);
      if (!cur) {
        deleted.push(k.id);
        continue;
      }
      if (!canViewProject(principal, { bahnhofsmanagement: cur.bahnhofsmanagement })) {
        deleted.push(k.id);
        continue;
      }
      if (cur.version <= k.version) continue;
      const missed = cur.version - k.version;
      const evs = missed <= MAX_REPLAY_EVENTS ? await this.store.eventsSince(k.id, k.version, MAX_REPLAY_EVENTS) : [];
      const contiguous = evs.length === missed && evs.every((e, i) => e.aggregateVersion === k.version + 1 + i);
      if (contiguous) events.push(...evs.map((e) => eventForPrincipal(principal, e)).filter((e) => e !== null));
      else {
        const d = await this.store.detail(k.id);
        if (d) snapshots.push(d);
      }
    }
    return { events, snapshots, deleted };
  }
  /**
   * Collection-level recovery: everything this principal may see that was
   * published after `after`, in feed order, recipient-filtered. `cursor` is the
   * highest feedSeq SCANNED (visible or not), so the next call never rescans.
   * `hasMore` means the scan budget ran out; the caller should ask again.
   */
  async changes(principal, input) {
    const page = Math.min(input.limit ?? 200, 500);
    const events = [];
    let cursor = input.after;
    let hasMore = false;
    for (let scans = 0; scans < 5; scans++) {
      const raw = await this.store.changesSince(cursor, page, input.upTo);
      for (const e of raw) {
        const out = eventForPrincipal(principal, e);
        if (out) events.push(out);
        cursor = e.feedSeq ?? cursor;
      }
      if (raw.length < page) return { events, cursor, hasMore: false };
      if (events.length >= page) {
        hasMore = true;
        break;
      }
      hasMore = scans === 4;
    }
    return { events, cursor, hasMore };
  }
  // ---- writes -------------------------------------------------------------
  async update(principal, input, ctx) {
    const parsed = ProjectPatchSchema.parse(input.changes);
    const norm = normalizePatch(parsed);
    const hash = requestHash("project.update", { id: input.id, v: input.expectedVersion, c: norm });
    const result = await this.store.transaction(async (tx) => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.update", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...claim.response, replayed: true };
      const current = await tx.lockProject(input.id);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canEditProject(principal, current)) throw new ForbiddenError2();
      const newBm = "bahnhofsmanagement" in norm ? norm.bahnhofsmanagement : current.bahnhofsmanagement;
      if (newBm !== current.bahnhofsmanagement && !canEditProject(principal, { bahnhofsmanagement: newBm })) {
        throw new ForbiddenError2("Keine Berechtigung f\xFCr das Ziel-Bahnhofsmanagement");
      }
      const changes = diffOf(current, norm);
      if (current.syncVersion !== input.expectedVersion) {
        throw await this.conflict(tx, current, input, norm);
      }
      if (Object.keys(changes).length === 0) {
        const detail2 = await tx.detail(input.id);
        const res2 = { project: detail2, eventId: "", replayed: false };
        await tx.completeIdempotency(principal.id, input.idempotencyKey, res2);
        return res2;
      }
      const ok = await tx.updateVersioned(input.id, input.expectedVersion, toColumnValues(
        Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to]))
      ));
      if (!ok) throw await this.conflict(tx, await tx.lockProject(input.id) ?? current, input, norm);
      const version = input.expectedVersion + 1;
      const event = this.buildEvent("project.updated", principal, ctx, input.id, version, changes, {
        workspace: newBm,
        workspaceBefore: newBm !== current.bahnhofsmanagement ? current.bahnhofsmanagement : null
      });
      await tx.appendAudit(this.auditRows(principal, event, "update", changes));
      await tx.appendEvent(event);
      await this.notifyWatchers(tx, principal, event, { id: input.id, projektnummer: current.projektnummer, station: "station" in changes ? changes.station.to : current.station });
      const detail = await tx.detail(input.id);
      const res = { project: detail, eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed && result.eventId) this.notifyAfterCommit();
    return result;
  }
  /**
   * A department review is part of the Project aggregate: editing one bumps the
   * PROJECT version, writes audit rows and one `project.updated` event whose
   * change keys are `review.<Gewerk>.<field>`. Same concurrency, same stream,
   * same recovery as a field edit — no second sync system.
   */
  async updateReview(principal, input, ctx) {
    const norm = {};
    for (const [f, v] of Object.entries(input.changes)) {
      if (v === void 0) continue;
      if (f === "datum") {
        const c = cleanStr(v);
        if (c === null) norm[f] = null;
        else {
          const d = new Date(c);
          if (Number.isNaN(d.getTime())) throw new ValidationError(`Ung\xFCltiges Datum: "${v}"`, f);
          norm[f] = dateToWire(d);
        }
      } else norm[f] = cleanStr(v);
    }
    const hash = requestHash("project.updateReview", { p: input.projectId, d: input.department, v: input.expectedVersion, c: norm });
    const result = await this.store.transaction(async (tx) => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.updateReview", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...claim.response, replayed: true };
      const current = await tx.lockProject(input.projectId);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canApproveReview(principal, current, input.department)) throw new ForbiddenError2("Keine Berechtigung f\xFCr dieses Gewerk");
      const review = await tx.lockReview(input.projectId, input.department);
      if (!review) throw new NotFoundError("Pr\xFCfung");
      const reviewWire = (f) => f === "datum" ? dateToWire(review.datum) : review[f];
      const changes = {};
      for (const [f, to] of Object.entries(norm)) {
        const from = reviewWire(f);
        if (from !== to) changes[reviewChangeKey(input.department, f)] = { from, to };
      }
      const localValues = Object.fromEntries(Object.entries(norm).map(([f, v]) => [reviewChangeKey(input.department, f), v ?? null]));
      const reviewValueOf = (key2) => reviewWire(key2.split(".")[2]);
      if (current.syncVersion !== input.expectedVersion) throw await this.conflict(tx, current, { id: input.projectId, expectedVersion: input.expectedVersion }, localValues, reviewValueOf);
      if (Object.keys(changes).length === 0) {
        const res2 = { project: await tx.detail(input.projectId), eventId: "", replayed: false };
        await tx.completeIdempotency(principal.id, input.idempotencyKey, res2);
        return res2;
      }
      await tx.updateReview(review.id, {
        ...norm.status !== void 0 ? { status: norm.status } : {},
        ...norm.prueferName !== void 0 ? { prueferName: norm.prueferName } : {},
        ...norm.datum !== void 0 ? { datum: norm.datum === null ? null : new Date(norm.datum) } : {}
      });
      const ok = await tx.updateVersioned(input.projectId, input.expectedVersion, {});
      if (!ok) throw await this.conflict(tx, await tx.lockProject(input.projectId) ?? current, { id: input.projectId, expectedVersion: input.expectedVersion }, localValues, reviewValueOf);
      const event = this.buildEvent("project.updated", principal, ctx, input.projectId, input.expectedVersion + 1, changes, { workspace: current.bahnhofsmanagement });
      await tx.appendAudit(this.auditRows(principal, event, "update", changes));
      await tx.appendEvent(event);
      await this.notifyWatchers(tx, principal, event, { id: input.projectId, projektnummer: current.projektnummer, station: current.station });
      const res = { project: await tx.detail(input.projectId), eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed && result.eventId) this.notifyAfterCommit();
    return result;
  }
  async create(principal, input, ctx) {
    const norm = normalizePatch(ProjectPatchSchema.parse(input.fields));
    const hash = requestHash("project.create", { c: norm });
    const result = await this.store.transaction(async (tx) => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.create", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...claim.response, replayed: true };
      if (!canCreateProject(principal, { bahnhofsmanagement: norm.bahnhofsmanagement ?? null })) throw new ForbiddenError2();
      const id = await tx.insertProject(toColumnValues(norm));
      const changes = {};
      for (const [k, to] of Object.entries(norm)) if (to !== null) changes[k] = { from: null, to };
      const event = this.buildEvent("project.created", principal, ctx, id, 1, changes, {
        workspace: norm.bahnhofsmanagement ?? null
      });
      await tx.appendAudit(this.auditRows(principal, event, "create", changes));
      await tx.appendEvent(event);
      const res = { project: await tx.detail(id), eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed) this.notifyAfterCommit();
    return result;
  }
  async delete(principal, input, ctx) {
    const hash = requestHash("project.delete", { id: input.id, v: input.expectedVersion });
    const result = await this.store.transaction(async (tx) => {
      const claim = await tx.claimIdempotency(principal.id, input.idempotencyKey, "project.delete", hash);
      if (claim.state === "mismatch") throw new IdempotencyKeyReuseError();
      if (claim.state === "replay") return { ...claim.response, replayed: true };
      const current = await tx.lockProject(input.id);
      if (!current || !canViewProject(principal, current)) throw new NotFoundError();
      if (!canDeleteProject(principal, current)) throw new ForbiddenError2();
      if (current.syncVersion !== input.expectedVersion) throw await this.conflict(tx, current, input, {});
      const version = current.syncVersion + 1;
      const event = this.buildEvent("project.deleted", principal, ctx, input.id, version, {}, {
        workspace: current.bahnhofsmanagement
      });
      await this.notifyWatchers(tx, principal, event, { id: input.id, projektnummer: current.projektnummer, station: current.station });
      await tx.deleteProject(input.id);
      await tx.appendAudit(this.auditRows(principal, event, "delete", {}));
      await tx.appendEvent(event);
      const res = { eventId: event.eventId, replayed: false };
      await tx.completeIdempotency(principal.id, input.idempotencyKey, res);
      return res;
    });
    if (!result.replayed) this.notifyAfterCommit();
    return result;
  }
  // ---- internals ----------------------------------------------------------
  /**
   * Domain event → policy → one notification row + one outbox event per recipient, in the
   * SAME transaction as the change. Recipients: the project's watchers except the actor.
   */
  async notifyWatchers(tx, principal, e, project) {
    const plan = planNotification(e, project);
    if (!plan) return;
    const workspace = e.context?.workspace ?? null;
    for (const userId of await tx.watchersOf(project.id)) {
      if (userId === principal.id) continue;
      const id = await tx.insertNotification({ userId, kind: plan.kind, title: plan.title, body: plan.body, link: plan.link, workspace, eventId: e.eventId });
      await tx.appendEvent({
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId: randomUUID(),
        eventType: "notification.created",
        aggregateType: "notification",
        aggregateId: String(id),
        aggregateVersion: 1,
        actorId: principal.id,
        actorName: principal.name,
        timestamp: this.clock().toISOString(),
        traceId: e.traceId,
        changes: {
          kind: { from: null, to: plan.kind },
          title: { from: null, to: plan.title },
          body: { from: null, to: plan.body },
          link: { from: null, to: plan.link },
          sourceEventId: { from: null, to: e.eventId }
        },
        context: { recipient: userId, workspace }
      });
    }
  }
  notifyAfterCommit() {
    try {
      this.afterCommit();
    } catch {
    }
  }
  buildEvent(eventType, principal, ctx, id, version, changes, context) {
    return {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: randomUUID(),
      eventType,
      aggregateType: "project",
      aggregateId: String(id),
      aggregateVersion: version,
      actorId: principal.id,
      actorName: principal.name,
      timestamp: this.clock().toISOString(),
      traceId: ctx.traceId,
      changes,
      context
    };
  }
  auditRows(principal, e, action, changes) {
    const base = {
      userId: actorNumericId(principal),
      userName: principal.name || principal.email || principal.id,
      entityType: "project",
      entityId: Number(e.aggregateId),
      action,
      eventId: e.eventId,
      aggregateVersion: e.aggregateVersion,
      traceId: e.traceId
    };
    const fields = Object.entries(changes);
    if (fields.length === 0) return [{ ...base, field: null, oldValue: null, newValue: null }];
    return fields.map(([field, c]) => ({ ...base, field, oldValue: c.from, newValue: c.to }));
  }
  async conflict(tx, current, input, norm, serverValueOf = (key2) => currentWire(current, key2)) {
    const missed = await tx.eventsSince(input.id, input.expectedVersion, 100);
    const changedSince = {};
    for (const e of missed) {
      for (const [f, c] of Object.entries(e.changes)) {
        changedSince[f] = { from: changedSince[f]?.from ?? c.from, to: c.to };
      }
    }
    const fields = Object.keys(norm);
    const conflictingFields = fields.filter((f) => f in changedSince);
    const last = missed[missed.length - 1];
    const detail = await tx.detail(input.id);
    const info = {
      code: "VERSION_CONFLICT",
      projectId: input.id,
      expectedVersion: input.expectedVersion,
      currentVersion: current.syncVersion,
      serverValues: Object.fromEntries(fields.map((f) => [f, serverValueOf(f)])),
      localValues: Object.fromEntries(fields.map((f) => [f, norm[f] ?? null])),
      conflictingFields,
      changedSince,
      lastChange: last ? { actorId: last.actorId, actorName: last.actorName ?? null, at: last.timestamp } : null,
      disjoint: conflictingFields.length === 0,
      current: detail
    };
    return new ConflictError(info);
  }
};

// server/infra/mysqlOutbox.ts
var LOCK = "bahn:outbox-relay";
var MysqlOutbox = class {
  constructor(pool) {
    this.pool = pool;
  }
  async drain(limit, publish) {
    const conn = await this.pool.getConnection();
    try {
      const [[lock]] = await conn.query("SELECT GET_LOCK(?, 0) AS got", [LOCK]);
      if (Number(lock.got) !== 1) return null;
      try {
        let [rows] = await conn.query(
          "SELECT id, envelope, feedSeq FROM domain_events WHERE processedAt IS NULL AND feedSeq IS NOT NULL ORDER BY feedSeq LIMIT ?",
          [limit]
        );
        if (!rows.length) {
          [rows] = await conn.query(
            "SELECT id, envelope, feedSeq FROM domain_events WHERE processedAt IS NULL ORDER BY id LIMIT ?",
            [limit]
          );
          const [[mx]] = await conn.query("SELECT COALESCE(MAX(feedSeq), 0) AS m FROM domain_events");
          let seq = Number(mx.m);
          const numbered = [];
          for (const r of rows) {
            try {
              DomainEventSchema.parse(typeof r.envelope === "string" ? JSON.parse(r.envelope) : r.envelope);
            } catch {
              continue;
            }
            r.feedSeq = ++seq;
            numbered.push([r.id, seq]);
          }
          if (numbered.length) {
            await conn.query(
              `UPDATE domain_events SET feedSeq = CASE id ${numbered.map(() => "WHEN ? THEN ?").join(" ")} END WHERE id IN (?)`,
              [...numbered.flat(), numbered.map((n) => n[0])]
            );
          }
        }
        const done = [];
        const dead = [];
        let failure;
        for (const r of rows) {
          let env;
          try {
            env = DomainEventSchema.parse(typeof r.envelope === "string" ? JSON.parse(r.envelope) : r.envelope);
            if (r.feedSeq !== null) env = { ...env, feedSeq: Number(r.feedSeq) };
          } catch (e) {
            dead.push({ id: r.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
            continue;
          }
          try {
            await publish(env);
            done.push(r.id);
          } catch (e) {
            failure = e;
            break;
          }
        }
        if (done.length) await conn.query("UPDATE domain_events SET processedAt = NOW(3) WHERE id IN (?)", [done]);
        for (const d of dead) {
          await conn.query("UPDATE domain_events SET processedAt = NOW(3), failedAt = NOW(3), failureReason = ? WHERE id = ?", [d.reason, d.id]);
        }
        if (dead.length) m.outboxDeadLetters.inc(void 0, dead.length);
        return { published: done.length, ...failure ? { failure } : {} };
      } finally {
        await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]).catch(() => {
        });
      }
    } finally {
      conn.release();
    }
  }
  async backlog() {
    const [[r]] = await this.pool.query("SELECT COUNT(*) AS n FROM domain_events WHERE processedAt IS NULL");
    return Number(r.n);
  }
};

// server/domain/ports.ts
var OVERFLOW = Symbol("realtime.overflow");

// server/realtime/hub.ts
var DEFAULT_MAX_QUEUE = 256;
var LocalHub = class {
  constructor(hooks = {}) {
    this.hooks = hooks;
  }
  channels = /* @__PURE__ */ new Map();
  get subscriberCount() {
    let n = 0;
    for (const s of this.channels.values()) n += s.size;
    return n;
  }
  get channelCount() {
    return this.channels.size;
  }
  deliver(channel, event) {
    const subs = this.channels.get(channel);
    if (!subs) return;
    for (const s of subs) {
      if (s.closed || s.seen.seen(event.eventId)) continue;
      if (s.queue.length >= s.max) {
        s.queue = [OVERFLOW];
        s.closed = true;
        m.rtDropped.inc();
      } else {
        s.queue.push(event);
      }
      s.wake?.();
    }
  }
  subscribe(scope2) {
    const sub = { queue: [], wake: null, closed: false, seen: new SeenEvents(512), max: scope2.maxQueue ?? DEFAULT_MAX_QUEUE };
    const channels = [...new Set(scope2.channels)];
    const hub = this;
    return {
      [Symbol.asyncIterator]() {
        for (const c of channels) {
          let set = hub.channels.get(c);
          if (!set) {
            hub.channels.set(c, set = /* @__PURE__ */ new Set());
            hub.hooks.onChannelOpen?.(c);
          }
          set.add(sub);
        }
        m.rtSubscriptions.add(channels.length);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          sub.closed = true;
          for (const c of channels) {
            const set = hub.channels.get(c);
            if (set?.delete(sub) && set.size === 0) {
              hub.channels.delete(c);
              hub.hooks.onChannelClose?.(c);
            }
          }
          m.rtSubscriptions.add(-channels.length);
          sub.wake?.();
        };
        scope2.signal?.addEventListener("abort", release, { once: true });
        if (scope2.signal?.aborted) release();
        return {
          async next() {
            for (; ; ) {
              const item = sub.queue.shift();
              if (item !== void 0) {
                if (item === OVERFLOW) release();
                return { value: item, done: false };
              }
              if (sub.closed) {
                release();
                return { value: void 0, done: true };
              }
              await new Promise((r) => {
                sub.wake = r;
              });
              sub.wake = null;
            }
          },
          async return() {
            release();
            return { value: void 0, done: true };
          }
        };
      }
    };
  }
};
var InProcessBus = class {
  hub = new LocalHub();
  async publish(event) {
    for (const c of scopesForEvent(event)) this.hub.deliver(c, event);
  }
  subscribe(scope2) {
    return this.hub.subscribe(scope2);
  }
};

// server/realtime/redisBus.ts
var PREFIX = "bahn:evt:";
var RedisBus = class {
  constructor(pub, sub, onError = () => {
  }) {
    this.pub = pub;
    this.sub = sub;
    this.onError = onError;
    this.hub = new LocalHub({
      onChannelOpen: (c) => {
        this.sub.subscribe(PREFIX + c).catch(this.onError);
      },
      onChannelClose: (c) => {
        this.sub.unsubscribe(PREFIX + c).catch(this.onError);
      }
    });
    this.sub.on("message", (channel, payload) => {
      try {
        const event = DomainEventSchema.parse(JSON.parse(payload));
        this.hub.deliver(channel.slice(PREFIX.length), event);
      } catch (e) {
        this.onError(e);
      }
    });
  }
  hub;
  async publish(event) {
    const payload = JSON.stringify(event);
    const p = this.pub.pipeline();
    for (const c of scopesForEvent(event)) p.publish(PREFIX + c, payload);
    const res = await p.exec();
    const failed2 = res?.find(([err]) => err);
    if (failed2?.[0]) throw failed2[0];
  }
  subscribe(scope2) {
    return this.hub.subscribe(scope2);
  }
};

// server/realtime/relay.ts
var OutboxRelay = class {
  constructor(store, publisher, opt = {}) {
    this.store = store;
    this.publisher = publisher;
    this.opt = opt;
  }
  timer = null;
  running = false;
  again = false;
  stopped = true;
  failures = 0;
  start() {
    this.stopped = false;
    this.schedule(0);
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 5));
  }
  /** Called right after a COMMIT so publication does not wait for the next poll. */
  nudge = () => {
    if (!this.stopped) {
      this.again = true;
      if (!this.running) this.schedule(0);
    }
  };
  schedule(ms) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }
  async tick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    let next = this.opt.pollMs ?? 250;
    try {
      const limit = this.opt.batch ?? 200;
      const res = await this.store.drain(limit, async (e) => {
        await this.publisher.publish(DomainEventSchema.parse(e));
      });
      if (res) {
        m.outboxPublished.inc(void 0, res.published);
        if (res.failure) throw res.failure;
        this.failures = 0;
        if (res.published === limit) next = 0;
      }
      if (this.again) {
        this.again = false;
        next = Math.min(next, 0);
      }
    } catch (e) {
      m.outboxFailures.inc();
      this.failures++;
      this.opt.onError?.(e);
      next = Math.min(this.opt.maxBackoffMs ?? 1e4, 100 * 2 ** this.failures);
    } finally {
      this.running = false;
      this.schedule(next);
    }
  }
};

// server/realtime/presence.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var PRESENCE_STATES = ["online", "away", "idle", "viewing", "editing"];
var RANK = { editing: 5, viewing: 4, online: 3, idle: 2, away: 1 };
function aggregate(members) {
  const by = /* @__PURE__ */ new Map();
  for (const m2 of members) (by.get(m2.userId) ?? by.set(m2.userId, []).get(m2.userId)).push(m2);
  return [...by.values()].map((ms) => {
    const best = ms.reduce((a, b) => RANK[b.state] > RANK[a.state] ? b : a);
    return { userId: best.userId, name: best.name, state: best.state, since: best.since, tabs: ms.length };
  }).sort((a, b) => RANK[b.state] - RANK[a.state] || (a.name ?? "").localeCompare(b.name ?? "") || a.userId.localeCompare(b.userId));
}
var sig = (es) => es.map((e) => `${e.userId}:${e.state}:${e.tabs}`).join("|");
var MemoryPresenceStore = class {
  ws = /* @__PURE__ */ new Map();
  async workspaceOf(scope2) {
    return this.ws.get(scope2) ?? null;
  }
  async setWorkspace(scope2, w) {
    if (w) this.ws.set(scope2, w);
  }
  scopes = /* @__PURE__ */ new Map();
  slot(scope2) {
    return this.scopes.get(scope2) ?? this.scopes.set(scope2, /* @__PURE__ */ new Map()).get(scope2);
  }
  live(scope2, now) {
    const s = this.scopes.get(scope2);
    if (!s) return [];
    for (const [k, m2] of s) if (m2.expiresAt <= now) s.delete(k);
    if (!s.size) this.scopes.delete(scope2);
    return [...this.scopes.get(scope2)?.values() ?? []];
  }
  async heartbeat(scope2, m2, ttlMs, now = Date.now()) {
    const before = sig(aggregate(this.live(scope2, now)));
    const key2 = `${m2.userId}:${m2.tabId}`;
    const prev = this.slot(scope2).get(key2);
    this.slot(scope2).set(key2, { ...m2, since: prev && prev.state === m2.state ? prev.since : new Date(now).toISOString(), expiresAt: now + ttlMs });
    return sig(aggregate(this.live(scope2, now))) !== before;
  }
  async leave(scope2, userId, tabId) {
    const now = Date.now();
    const before = sig(aggregate(this.live(scope2, now)));
    this.scopes.get(scope2)?.delete(`${userId}:${tabId}`);
    return sig(aggregate(this.live(scope2, now))) !== before;
  }
  async list(scope2, now = Date.now()) {
    return aggregate(this.live(scope2, now));
  }
  async sweep(now = Date.now()) {
    const changed = [];
    for (const scope2 of [...this.scopes.keys()]) {
      const before = this.scopes.get(scope2).size;
      this.live(scope2, now);
      if ((this.scopes.get(scope2)?.size ?? 0) !== before) changed.push(scope2);
    }
    return changed;
  }
};
var RedisPresenceStore = class {
  constructor(r, prefix = "bahn:pres:") {
    this.r = r;
    this.prefix = prefix;
  }
  h = (s) => `${this.prefix}h:${s}`;
  z = (s) => `${this.prefix}z:${s}`;
  get scopesKey() {
    return `${this.prefix}scopes`;
  }
  get wsKey() {
    return `${this.prefix}ws`;
  }
  async workspaceOf(scope2) {
    return await this.r.hget(this.wsKey, scope2) ?? null;
  }
  async setWorkspace(scope2, w) {
    if (w) await this.r.hset(this.wsKey, scope2, w);
  }
  async prune(scope2, now) {
    const dead = await this.r.zrangebyscore(this.z(scope2), "-inf", now);
    if (dead.length) await this.r.multi().hdel(this.h(scope2), ...dead).zrem(this.z(scope2), ...dead).exec();
  }
  async members(scope2, now) {
    await this.prune(scope2, now);
    const raw = await this.r.hvals(this.h(scope2));
    return raw.map((x) => JSON.parse(x));
  }
  async heartbeat(scope2, m2, ttlMs, now = Date.now()) {
    const before = sig(aggregate(await this.members(scope2, now)));
    const key2 = `${m2.userId}:${m2.tabId}`;
    const prevRaw = await this.r.hget(this.h(scope2), key2);
    const prev = prevRaw ? JSON.parse(prevRaw) : null;
    const member = { ...m2, since: prev && prev.state === m2.state ? prev.since : new Date(now).toISOString(), expiresAt: now + ttlMs };
    await this.r.multi().hset(this.h(scope2), key2, JSON.stringify(member)).zadd(this.z(scope2), member.expiresAt, key2).pexpire(this.h(scope2), ttlMs * 6).pexpire(this.z(scope2), ttlMs * 6).sadd(this.scopesKey, scope2).exec();
    return sig(aggregate(await this.members(scope2, now))) !== before;
  }
  async leave(scope2, userId, tabId) {
    const now = Date.now();
    const before = sig(aggregate(await this.members(scope2, now)));
    const key2 = `${userId}:${tabId}`;
    await this.r.multi().hdel(this.h(scope2), key2).zrem(this.z(scope2), key2).exec();
    return sig(aggregate(await this.members(scope2, now))) !== before;
  }
  async list(scope2, now = Date.now()) {
    return aggregate(await this.members(scope2, now));
  }
  async sweep(now = Date.now()) {
    const changed = [];
    for (const scope2 of await this.r.smembers(this.scopesKey)) {
      const before = await this.r.hlen(this.h(scope2));
      const live = await this.members(scope2, now);
      if (live.length !== before) changed.push(scope2);
      if (!live.length) await this.r.srem(this.scopesKey, scope2);
    }
    return changed;
  }
};
function presenceEvent(scope2, entries, workspace, now = Date.now()) {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: randomUUID2(),
    eventType: "presence.changed",
    aggregateType: "presence",
    aggregateId: scope2,
    aggregateVersion: Math.max(1, now),
    actorId: "system",
    timestamp: new Date(now).toISOString(),
    traceId: "presence",
    changes: { members: { from: null, to: JSON.stringify(entries) } },
    context: { workspace }
  };
}
var TTL_MS = 45e3;
var PresenceService = class {
  constructor(store, publisher) {
    this.store = store;
    this.publisher = publisher;
  }
  async heartbeat(scope2, who, workspace) {
    if (!isValidScope(scope2)) throw new Error("bad scope");
    if (workspace) await this.store.setWorkspace(scope2, workspace);
    const changed = await this.store.heartbeat(scope2, who, TTL_MS);
    if (changed) await this.publish(scope2, workspace);
  }
  async leave(scope2, userId, tabId, workspace) {
    if (await this.store.leave(scope2, userId, tabId)) await this.publish(scope2, workspace);
  }
  list(scope2) {
    return this.store.list(scope2);
  }
  async sweep() {
    for (const scope2 of await this.store.sweep()) await this.publish(scope2, await this.store.workspaceOf(scope2));
  }
  async publish(scope2, workspace) {
    await this.publisher.publish(presenceEvent(scope2, await this.store.list(scope2), workspace));
  }
};

// server/_core/services.ts
var services = null;
async function getServices(log = console.error) {
  if (services) return services;
  const db = await getDb();
  const pool = getPool();
  const relayPool = getRelayPool();
  if (!db || !pool || !relayPool) return null;
  let bus;
  let presenceStore = new MemoryPresenceStore();
  let sweepLock = null;
  const closers = [];
  if (process.env.REDIS_URL) {
    const { default: IORedis } = await import("ioredis");
    const pub = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, enableAutoPipelining: true });
    const sub = new IORedis(process.env.REDIS_URL);
    pub.on("error", (e) => log("[redis:pub]", e));
    sub.on("error", (e) => log("[redis:sub]", e));
    bus = new RedisBus(pub, sub, (e) => log("[redis:bus]", e));
    presenceStore = new RedisPresenceStore(pub);
    sweepLock = async () => await pub.set("bahn:pres:sweeper", "1", "PX", 9e3, "NX") === "OK";
    closers.push(() => pub.quit(), () => sub.quit());
  } else {
    bus = new InProcessBus();
  }
  const store = new MysqlProjectStore(db);
  const outbox = new MysqlOutbox(relayPool);
  const relay = new OutboxRelay(outbox, bus, { onError: (e) => log("[outbox]", e) });
  const svc = new ProjectService(store, relay.nudge);
  const sampler = setInterval(async () => {
    try {
      m.outboxBacklog.set(await outbox.backlog());
      const p = pool.pool;
      if (p) {
        m.poolInUse.set((p._allConnections?.length ?? 0) - (p._freeConnections?.length ?? 0));
        m.poolQueued.set(p._connectionQueue?.length ?? 0);
      }
    } catch {
    }
  }, 5e3);
  sampler.unref();
  const presence = new PresenceService(presenceStore, bus);
  const sweeper = setInterval(async () => {
    try {
      if (!sweepLock || await sweepLock()) await presence.sweep();
    } catch (e) {
      log("[presence:sweep]", e);
    }
  }, 1e4);
  sweeper.unref();
  relay.start();
  services = {
    store,
    projects: svc,
    publisher: bus,
    subscriber: bus,
    relay,
    presence,
    pool,
    async shutdown() {
      clearInterval(sampler);
      clearInterval(sweeper);
      await relay.stop();
      await Promise.allSettled(closers.map((c) => c()));
    }
  };
  return services;
}
async function requireServices() {
  const s = await getServices();
  if (!s) throw new Error("Database not configured");
  return s;
}

// shared/review-status.ts
var OPEN_STATUSES = [
  "offen",
  "in Bearbeitung",
  "Nachforderung",
  "pr\xFCff\xE4hig"
];
var APPROVED_STATUSES = [
  "Zustimmung erteilt",
  "Niederschrift erstellt"
];
var BLOCKING_STATUSES = ["abgelehnt", "gestoppt"];
function fold2(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
}
var CANONICAL_BY_FOLD2 = new Map(
  REVIEW_STATUSES.map((s) => [fold2(s), s])
);
var ALIAS_BY_FOLD2 = /* @__PURE__ */ new Map([
  [fold2("Projektkonfiguration"), "Projektkonfig."],
  [fold2("Projektkonfig"), "Projektkonfig."]
]);
function normalizeReviewStatus(input) {
  if (input == null) return null;
  const cleaned = String(input).replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;
  const key2 = fold2(cleaned);
  const direct = CANONICAL_BY_FOLD2.get(key2);
  if (direct) return direct;
  const alias = ALIAS_BY_FOLD2.get(key2);
  if (alias) return alias;
  const stripped = fold2(cleaned.replace(/\s*\([^)]*\)\s*$/, ""));
  return CANONICAL_BY_FOLD2.get(stripped) ?? ALIAS_BY_FOLD2.get(stripped) ?? null;
}

// shared/project-metrics.ts
var OPEN = new Set(OPEN_STATUSES);
var APPROVED = new Set(APPROVED_STATUSES);
var BLOCKING2 = new Set(BLOCKING_STATUSES);
var IN_FLIGHT = /* @__PURE__ */ new Set(["in Bearbeitung", "pr\xFCff\xE4hig", "Nachforderung"]);
var EMPTY_METRICS = Object.freeze({
  total: 0,
  active: 0,
  completed: 0,
  blocked: 0,
  notStarted: 0,
  openReviews: 0,
  approvedReviews: 0,
  notRequiredReviews: 0,
  unresolvedReviews: 0,
  blockedReviews: 0,
  totalReviews: 0,
  unclassified: 0
});
function deriveProjectMetrics(projects2) {
  if (!projects2 || projects2.length === 0) return { ...EMPTY_METRICS };
  const m2 = { ...EMPTY_METRICS, total: projects2.length };
  for (const project of projects2) {
    const reviews = project.reviews ?? [];
    let required = 0;
    let approved = 0;
    let inFlight = 0;
    let blocked = 0;
    for (const review of reviews) {
      m2.totalReviews += 1;
      const status = normalizeReviewStatus(review.status);
      if (status === null) {
        m2.unresolvedReviews += 1;
        continue;
      }
      if (status === "nicht erforderlich") {
        m2.notRequiredReviews += 1;
        continue;
      }
      required += 1;
      if (APPROVED.has(status)) {
        approved += 1;
        m2.approvedReviews += 1;
      } else if (BLOCKING2.has(status)) {
        blocked += 1;
        m2.blockedReviews += 1;
      } else if (OPEN.has(status)) {
        m2.openReviews += 1;
        if (IN_FLIGHT.has(status)) inFlight += 1;
      } else {
        m2.unresolvedReviews += 1;
      }
    }
    if (blocked > 0) {
      m2.blocked += 1;
    } else if (required > 0 && approved === required) {
      m2.completed += 1;
    } else if (inFlight > 0) {
      m2.active += 1;
    } else if (required > 0) {
      m2.notStarted += 1;
    } else {
      m2.unclassified += 1;
    }
  }
  return m2;
}

// server/infra/singleFlightCache.ts
var hits = counter("bahn_cache_hits_total", "Read-model cache hits by name and kind (fresh|stale)");
var misses = counter("bahn_cache_misses_total", "Read-model cache misses (a load ran)");
var SingleFlightCache = class {
  constructor(name, ttlMs, load, maxStaleMs = 10 * 6e4, now = Date.now) {
    this.name = name;
    this.ttlMs = ttlMs;
    this.load = load;
    this.maxStaleMs = maxStaleMs;
    this.now = now;
  }
  entry = null;
  inflight = null;
  invalidate() {
    if (this.entry) this.entry.at = 0;
  }
  async get() {
    const e = this.entry;
    const age = e ? this.now() - e.at : Infinity;
    if (e && age < this.ttlMs) {
      hits.inc({ name: this.name, kind: "fresh" });
      return e.value;
    }
    if (e && age < this.maxStaleMs) {
      hits.inc({ name: this.name, kind: "stale" });
      if (!e.refreshing) {
        e.refreshing = this.fill().then(() => void 0, () => void 0).finally(() => {
          if (this.entry === e) e.refreshing = null;
        });
      }
      return e.value;
    }
    misses.inc({ name: this.name });
    return this.fill();
  }
  fill() {
    if (this.inflight) return this.inflight;
    const p = this.load().then((value) => {
      this.entry = { value, at: this.now(), refreshing: null };
      return value;
    }).finally(() => {
      this.inflight = null;
    });
    this.inflight = p;
    return p;
  }
};

// server/routers.ts
var shellCache = null;
async function shellSummaryCached(load) {
  if (shellCache && Date.now() - shellCache.at < 5e3) return shellCache.value;
  const value = await load();
  shellCache = { at: Date.now(), value };
  return value;
}
var auditActor = (p) => ({
  userId: /^\d+$/.test(p.id) ? Number(p.id) : null,
  userName: p.name || p.email || p.id
});
var dashboardCache = new SingleFlightCache("dashboard", 3e4, () => getDashboardStats());
async function computeMetrics(workspaces) {
  const { pool } = await requireServices();
  if (workspaces !== null && workspaces.length === 0) return deriveProjectMetrics([]);
  const [rows] = await pool.query(
    `SELECT p.id AS id, r.status AS status FROM projects p LEFT JOIN department_reviews r ON r.projectId = p.id${workspaces ? " WHERE p.bahnhofsmanagement IN (?)" : ""}`,
    workspaces ? [workspaces] : []
  );
  const by = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const list = by.get(r.id) ?? [];
    if (r.status !== null) list.push({ status: r.status });
    by.set(r.id, list);
  }
  return deriveProjectMetrics([...by.values()].map((reviews) => ({ reviews })));
}
var metricsCache = new SingleFlightCache("metrics", 3e4, () => computeMetrics(null));
var filterOptionsCache = new SingleFlightCache("filters", 6e4, () => getFilterOptions());
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    /** The verified principal (what authorization actually uses): role, workspaces, departments. */
    session: publicProcedure.query(
      ({ ctx }) => ctx.principal ? { id: ctx.principal.id, name: ctx.principal.name, email: ctx.principal.email, role: ctx.principal.role, workspaces: ctx.principal.workspaces, departments: [...ctx.principal.departments] } : null
    ),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),
    // Demo login procedure - replaces OAuth for standalone deployment
    demoLogin: publicProcedure.input(z6.object({
      email: z6.string().email(),
      password: z6.string()
    })).mutation(async ({ input, ctx }) => {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_LOGIN !== "1") {
        throw new TRPCError3({ code: "NOT_FOUND", message: "Not found" });
      }
      const { DEMO_USERS } = await import("./demoUsers-CGHM5YO4.js");
      const demoUser = DEMO_USERS.find((u) => u.email === input.email && u.password === input.password);
      if (!demoUser) {
        throw new TRPCError3({ code: "UNAUTHORIZED", message: "Ung\xFCltige Anmeldedaten" });
      }
      await upsertUser({
        openId: demoUser.openId,
        name: demoUser.name,
        email: demoUser.email,
        role: demoUser.role,
        loginMethod: "demo",
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const token = await sdk.createSessionToken(demoUser.openId, {
        name: demoUser.name
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1e3
      });
      return { success: true, user: { name: demoUser.name, email: demoUser.email, role: demoUser.role } };
    })
  }),
  // ============= PROJECTS =============
  // Server-authoritative slice: docs/data-plane.md. Reads are cursor-paginated
  // summaries; writes are versioned, idempotent, audited and evented.
  projects: router({
    list: protectedProcedure.input(ListProjectsInputSchema).query(async ({ input, ctx }) => {
      const { store } = await requireServices();
      const feedHead = await store.feedHead();
      const page = await store.list(input, { workspaces: workspaceRestriction(ctx.principal) });
      return { ...page, feedHead };
    }),
    get: protectedProcedure.input(z6.object({ id: z6.number().int().positive() })).query(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      return projects2.get(ctx.principal, input.id);
    }),
    update: protectedProcedure.input(UpdateProjectInputSchema).mutation(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      const start = performance.now();
      try {
        const res = await projects2.update(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
        m.mutations.inc({ outcome: res.replayed ? "replay" : "ok" });
        return res;
      } catch (e) {
        if (e instanceof ConflictError) {
          m.conflicts.inc();
          m.mutations.inc({ outcome: "conflict" });
        } else m.mutations.inc({ outcome: "error" });
        throw e;
      } finally {
        m.dbMs.observe(performance.now() - start);
      }
    }),
    create: protectedProcedure.input(CreateProjectInputSchema).mutation(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      return projects2.create(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
    }),
    delete: protectedProcedure.input(z6.object({
      id: z6.number().int().positive(),
      expectedVersion: z6.number().int().min(1),
      idempotencyKey: z6.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/)
    })).mutation(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      return projects2.delete(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
    }),
    /** Collection recovery: visible changes after a feed cursor (see docs/data-plane.md). */
    changes: protectedProcedure.input(z6.object({ after: z6.number().int().min(0), upTo: z6.number().int().min(0).optional(), limit: z6.number().int().min(1).max(500).optional() })).query(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      return projects2.changes(ctx.principal, input);
    }),
    /** Reconnect recovery: what changed since the versions the client holds. */
    sync: protectedProcedure.input(SyncInputSchema).mutation(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      return projects2.sync(ctx.principal, input.known);
    }),
    /** Department-review edit: versioned (project version), audited, evented. */
    updateReview: protectedProcedure.input(UpdateReviewInputSchema).mutation(async ({ input, ctx }) => {
      const { projects: projects2 } = await requireServices();
      try {
        const res = await projects2.updateReview(ctx.principal, input, { traceId: ctx.traceId, requestId: ctx.requestId });
        m.mutations.inc({ outcome: res.replayed ? "replay" : "ok" });
        return res;
      } catch (e) {
        if (e instanceof ConflictError) {
          m.conflicts.inc();
          m.mutations.inc({ outcome: "conflict" });
        } else m.mutations.inc({ outcome: "error" });
        throw e;
      }
    }),
    /** Follow / unfollow a project (recipient set of the notification policy). */
    watch: protectedProcedure.input(z6.object({ projectId: z6.number().int().positive(), on: z6.boolean() })).mutation(async ({ input, ctx }) => {
      const { store, projects: projects2 } = await requireServices();
      await projects2.get(ctx.principal, input.projectId);
      if (input.on) await store.watch(input.projectId, ctx.principal.id);
      else await store.unwatch(input.projectId, ctx.principal.id);
      return { watching: input.on };
    }),
    watching: protectedProcedure.input(z6.object({ projectId: z6.number().int().positive() })).query(async ({ input, ctx }) => {
      const { store } = await requireServices();
      return { watching: await store.isWatching(input.projectId, ctx.principal.id) };
    }),
    /** Global-chrome summary: replaces useAllProjects() in the shell. */
    shellSummary: protectedProcedure.query(async () => {
      const { store } = await requireServices();
      return shellSummaryCached(() => store.shellSummary());
    }),
    searchSuggestions: protectedProcedure.input(z6.object({ term: z6.string().trim().min(1).max(100) })).query(async ({ input }) => {
      return getSearchSuggestions(input.term);
    })
  }),
  // ============= DEPARTMENT REVIEWS =============
  reviews: router({
    // reviews.update (unversioned, unevented) was removed: use projects.updateReview.
    create: protectedProcedure.input(z6.object({
      projectId: z6.number(),
      department: z6.string(),
      prueferName: z6.string().optional(),
      datum: z6.string().optional(),
      status: z6.string().optional()
    })).mutation(async ({ input, ctx }) => {
      const id = await createDepartmentReview({
        ...input,
        datum: input.datum ? new Date(input.datum) : null
      });
      await createAuditEntry({
        ...auditActor(ctx.principal),
        entityType: "review",
        entityId: id,
        action: "create",
        field: null,
        oldValue: null,
        newValue: JSON.stringify(input)
      });
      return { id };
    })
  }),
  // ============= NOTIFICATIONS =============
  // Source of truth for the bell: rows written in the same transaction as the change (see
  // ProjectService.notifyWatchers), delivered live on notifications:<self>.
  notifications: router({
    list: protectedProcedure.input(z6.object({ cursor: z6.number().int().positive().optional(), limit: z6.number().int().min(1).max(100).default(30), unreadOnly: z6.boolean().default(false) })).query(async ({ input, ctx }) => {
      const { store } = await requireServices();
      return store.listNotifications(ctx.principal.id, input, workspaceRestriction(ctx.principal));
    }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      const { store } = await requireServices();
      return { count: await store.unreadCount(ctx.principal.id, workspaceRestriction(ctx.principal)) };
    }),
    markRead: protectedProcedure.input(z6.object({ ids: z6.union([z6.literal("all"), z6.array(z6.number().int().positive()).min(1).max(200)]) })).mutation(async ({ input, ctx }) => {
      const { store } = await requireServices();
      await store.markRead(ctx.principal.id, input.ids);
      return { ok: true };
    })
  }),
  // ============= DASHBOARD =============
  dashboard: router({
    // Aggregates are a server-side read model: computed once per TTL (single
    // flight, stale-while-revalidate), never per browser or per request.
    stats: protectedProcedure.query(({ ctx }) => {
      if (workspaceRestriction(ctx.principal) !== null) throw new TRPCError3({ code: "FORBIDDEN", message: "Dashboard nur mit Zugriff auf alle Workspaces" });
      return dashboardCache.get();
    }),
    /** KPI cards: shared/project-metrics.ts run server-side over (project, status) rows. */
    metrics: protectedProcedure.query(({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      return restriction === null ? metricsCache.get() : computeMetrics(restriction);
    })
  }),
  // ============= BVB-EEA =============
  bvbEea: router({
    list: protectedProcedure.query(async () => {
      return getBvbEeaList();
    }),
    create: protectedProcedure.input(z6.object({
      projektnummer: z6.string().optional(),
      bahnhofsmanagement: z6.string().optional(),
      station: z6.string().optional(),
      bahnhofsnummer: z6.string().optional(),
      streckennummer: z6.string().optional(),
      projektbeschreibung: z6.string().optional(),
      projektleiter: z6.string().optional(),
      eigvAnzeige: z6.string().optional(),
      kommentar: z6.string().optional(),
      freigabeNummer: z6.string().optional(),
      kosteneinsparung: z6.string().optional()
    })).mutation(async ({ input }) => {
      const id = await createBvbEea({
        ...input,
        eigvAnzeige: input.eigvAnzeige ? new Date(input.eigvAnzeige) : null
      });
      return { id };
    }),
    update: protectedProcedure.input(z6.object({
      id: z6.number().int().positive(),
      field: z6.enum(["projektnummer", "bahnhofsmanagement", "station", "bahnhofsnummer", "streckennummer", "projektbeschreibung", "projektleiter", "kommentar", "freigabeNummer", "kosteneinsparung"]),
      value: z6.string().max(5e3).nullable()
    })).mutation(async ({ input }) => {
      await updateBvbEea(input.id, { [input.field]: input.value });
      return { success: true };
    })
  }),
  // ============= PSV-ITK =============
  psvItk: router({
    list: protectedProcedure.query(async () => {
      return getPsvItkList();
    }),
    create: protectedProcedure.input(z6.object({
      projektnummer: z6.string().optional(),
      bahnhofsmanagement: z6.string().optional(),
      station: z6.string().optional(),
      bahnhofsnummer: z6.string().optional(),
      streckennummer: z6.string().optional(),
      projektbeschreibung: z6.string().optional(),
      projektstand: z6.string().optional(),
      projektleiter: z6.string().optional(),
      terminProjektvorstellung: z6.string().optional(),
      itkPruefer: z6.string().optional(),
      kommentar: z6.string().optional()
    })).mutation(async ({ input }) => {
      const id = await createPsvItk({
        ...input,
        terminProjektvorstellung: input.terminProjektvorstellung ? new Date(input.terminProjektvorstellung) : null
      });
      return { id };
    }),
    update: protectedProcedure.input(z6.object({
      id: z6.number().int().positive(),
      field: z6.enum(["projektnummer", "bahnhofsmanagement", "station", "bahnhofsnummer", "streckennummer", "projektbeschreibung", "projektstand", "projektleiter", "itkPruefer", "kommentar"]),
      value: z6.string().max(5e3).nullable()
    })).mutation(async ({ input }) => {
      await updatePsvItk(input.id, { [input.field]: input.value });
      return { success: true };
    })
  }),
  // ============= AUDIT LOG =============
  audit: router({
    list: protectedProcedure.input(z6.object({
      entityType: z6.string().optional(),
      entityId: z6.number().optional(),
      limit: z6.number().max(500).default(100)
    }).optional()).query(async ({ input, ctx }) => {
      if (!canViewAudit(ctx.principal)) throw new TRPCError3({ code: "FORBIDDEN" });
      return getAuditLog(input ?? {});
    })
  }),
  // ============= FILTERS =============
  filters: router({
    options: protectedProcedure.query(async ({ ctx }) => {
      const restriction = workspaceRestriction(ctx.principal);
      if (restriction === null) return filterOptionsCache.get();
      const { store } = await requireServices();
      return store.filterOptions(restriction);
    })
  }),
  // ============= ODATA (tRPC facade + full Express router available at /odata) =============
  odata: router({
    /**
     * tRPC-friendly OData query (used by future React Query hooks)
     * Returns standard ODataResponse shape
     */
    queryProjects: protectedProcedure.input(ODataQuerySchema).query(async ({ input, ctx }) => {
      const { store } = await requireServices();
      const $top = Math.min(input.$top ?? 100, MAX_PAGE_SIZE);
      const $skip = Math.min(input.$skip ?? 0, 1e4);
      const parsed = input.$filter ? parseODataFilter(input.$filter) : {};
      const page = await store.list(
        {
          limit: $top,
          sort: "id",
          dir: "asc",
          includeTotal: true,
          expand: [],
          ...parsed.projektstand ? { projektstand: parsed.projektstand } : {}
        },
        { workspaces: workspaceRestriction(ctx.principal) },
        { offset: $skip, ...parsed.station ?? parsed.station_contains ? { stationPrefix: String(parsed.station ?? parsed.station_contains) } : {} }
      );
      return {
        value: page.items,
        "@odata.count": page.total ?? page.items.length,
        "@odata.context": "/odata/$metadata#projects"
      };
    }),
    /**
     * Returns the EDM metadata (same as Express $metadata)
     */
    metadata: publicProcedure.query(() => {
      return { metadataUrl: "/odata/$metadata", version: "4.0" };
    })
  })
});

// server/observability/trace.ts
import { randomBytes } from "node:crypto";
var TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
var safe = (v) => typeof v === "string" && /^[A-Za-z0-9._:-]{8,64}$/.test(v) ? v : null;
function traceIdFrom(h) {
  const tp = typeof h.traceparent === "string" ? TRACEPARENT.exec(h.traceparent) : null;
  return tp?.[1] ?? safe(h["x-trace-id"]) ?? safe(h["x-request-id"]) ?? randomBytes(16).toString("hex");
}
var newRequestId = () => randomBytes(8).toString("hex");

// server/_core/identity.ts
import { createHash as createHash2 } from "node:crypto";
import { parse as parseCookie } from "cookie";

// server/infra/userProvisioner.ts
var written = counter("bahn_user_provision_written_total", "OIDC users written by the provisioner");
var failed = counter("bahn_user_provision_failures_total", "Provisioner batch failures");
var UserProvisioner = class {
  constructor(write2, opt = {}) {
    this.write = write2;
    this.opt = opt;
  }
  pending = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Map();
  timer = null;
  /** O(1), never awaits the database. */
  enqueue(u) {
    const now = (this.opt.now ?? Date.now)();
    const last = this.seen.get(u.openId);
    if (last !== void 0 && now - last < (this.opt.ttlMs ?? 10 * 6e4)) return;
    if (this.seen.size >= (this.opt.maxSeen ?? 1e5)) this.seen.delete(this.seen.keys().next().value);
    this.seen.set(u.openId, now);
    this.pending.set(u.openId, u);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.opt.flushMs ?? 1e3);
      this.timer.unref?.();
    }
  }
  get queued() {
    return this.pending.size;
  }
  async flush() {
    const batchSize = this.opt.batch ?? 500;
    while (this.pending.size) {
      const batch = [...this.pending.values()].slice(0, batchSize);
      for (const u of batch) this.pending.delete(u.openId);
      try {
        await this.write(batch);
        written.inc(void 0, batch.length);
      } catch {
        failed.inc();
        for (const u of batch) this.seen.delete(u.openId);
      }
    }
  }
};

// server/_core/oidc.ts
import { createRemoteJWKSet, jwtVerify as jwtVerify2 } from "jose";
function oidcConfigFromEnv(env = process.env) {
  const issuer = env.OIDC_ISSUER, audience = env.OIDC_AUDIENCE;
  if (!issuer || !audience) return null;
  const tenant = /login\.microsoftonline\.com\/([^/]+)/.exec(issuer)?.[1];
  const uri = env.OIDC_JWKS_URI ?? (tenant ? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys` : `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`);
  return { issuer, audience, jwks: createRemoteJWKSet(new URL(uri), { cooldownDuration: 3e4, cacheMaxAge: 10 * 6e4 }) };
}
function workspacesFromClaim(v) {
  const list = strings(v).map((s) => s.trim()).filter(Boolean);
  return list.some((s) => s.toUpperCase() === "ALL") ? "ALL" : list;
}
var strings = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
async function verifyBearer(token, cfg) {
  const { payload } = await jwtVerify2(token, cfg.jwks, {
    issuer: cfg.issuer,
    audience: cfg.audience,
    algorithms: ["RS256", "ES256", "PS256"],
    clockTolerance: 30
  });
  const roles = strings(payload.roles).map((r) => r.toLowerCase());
  const role = roles.includes("admin") ? "admin" : roles.includes("editor") ? "editor" : "viewer";
  const tid = typeof payload.tid === "string" ? payload.tid : null;
  const oid = typeof payload.oid === "string" ? payload.oid : null;
  const subject = tid && oid ? `${tid}:${oid}` : String(payload.sub ?? "");
  if (!subject) throw new Error("token has no subject");
  return {
    subject,
    name: typeof payload.name === "string" ? payload.name : null,
    email: typeof payload.email === "string" ? payload.email : typeof payload.preferred_username === "string" ? payload.preferred_username : null,
    role,
    workspaces: workspacesFromClaim(payload.workspaces),
    departments: strings(payload.departments)
  };
}

// server/_core/identity.ts
var _provisioner = null;
function provisioner() {
  return _provisioner ??= new UserProvisioner(async (users2) => {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      `INSERT INTO users (openId, name, email, loginMethod, role, lastSignedIn) VALUES ${users2.map(() => "(?, ?, ?, 'oidc', ?, NOW())").join(",")}
       ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), role = VALUES(role), lastSignedIn = NOW()`,
      users2.flatMap((u) => [u.openId, u.name, u.email, u.role])
    );
  });
}
var TTL_MS2 = 3e4;
var MAX_ENTRIES = 2e4;
var cache = /* @__PURE__ */ new Map();
var oidc;
var getOidc = () => oidc === void 0 ? oidc = oidcConfigFromEnv() : oidc;
function remember(k, value) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(k, { at: Date.now(), value });
}
function principalFromUser(user, extra) {
  return {
    id: String(user.id),
    name: user.name ?? null,
    email: user.email ?? null,
    role: extra?.role ?? roleFromLegacy(user.role),
    // Default-deny: a user with no explicit workspace grant sees no workspace.
    // Admins are unrestricted by role. Demo logins (development convenience) and
    // deployments that explicitly set LEGACY_USER_WORKSPACES=ALL keep the old open behaviour.
    workspaces: extra?.workspaces ?? (user.role === "admin" || user.loginMethod === "demo" || process.env.LEGACY_USER_WORKSPACES === "ALL" ? "ALL" : []),
    departments: extra?.departments ?? []
  };
}
var inflight = /* @__PURE__ */ new Map();
function singleFlight(key2, load) {
  const existing = inflight.get(key2);
  if (existing) return existing;
  const p = load().finally(() => inflight.delete(key2));
  inflight.set(key2, p);
  return p;
}
async function resolveIdentity(req) {
  const t0 = performance.now();
  try {
    return await resolveIdentityInner(req);
  } finally {
    m.identityMs.observe(performance.now() - t0);
  }
}
async function resolveIdentityInner(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const cfg = getOidc();
    if (!cfg) return null;
    const token = auth.slice(7).trim();
    const ck2 = "b:" + createHash2("sha256").update(token).digest("hex");
    const hit2 = cache.get(ck2);
    if (hit2 && Date.now() - hit2.at < TTL_MS2) return hit2.value;
    return singleFlight(ck2, async () => {
      try {
        const t0 = performance.now();
        const id = await verifyBearer(token, cfg);
        m.authVerifyMs.observe(performance.now() - t0);
        const openId = `oidc:${id.subject}`;
        const principal = {
          // stable, fits the 64-char actor columns, never a raw tenant/object id
          id: `o${createHash2("sha256").update(openId).digest("hex").slice(0, 31)}`,
          name: id.name,
          email: id.email,
          role: id.role,
          workspaces: id.workspaces,
          departments: id.departments
        };
        provisioner().enqueue({ openId: openId.slice(0, 64), name: id.name, email: id.email, role: id.role === "admin" ? "admin" : "user" });
        const value = { user: null, principal };
        remember(ck2, value);
        return value;
      } catch {
        return null;
      }
    });
  }
  const cookie = req.headers.cookie ? parseCookie(req.headers.cookie)[COOKIE_NAME] : void 0;
  if (!cookie) return null;
  const ck = "c:" + createHash2("sha256").update(cookie).digest("hex");
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS2) return hit.value;
  return singleFlight(ck, async () => {
    try {
      const user = await sdk.authenticateRequest(req);
      const value = { user, principal: principalFromUser(user) };
      remember(ck, value);
      return value;
    } catch {
      return null;
    }
  });
}

// server/_core/context.ts
async function createContext(opts) {
  const identity = await resolveIdentity(opts.req);
  const traceId = traceIdFrom(opts.req.headers);
  const requestId = newRequestId();
  opts.res.setHeader("x-trace-id", traceId);
  opts.res.setHeader("x-request-id", requestId);
  return {
    req: opts.req,
    res: opts.res,
    user: identity?.user ?? null,
    principal: identity?.principal ?? null,
    traceId,
    requestId
  };
}

// server/_core/static.ts
import express from "express";
import fs from "node:fs";
import path from "node:path";
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path.resolve(import.meta.dirname, "../..", "dist", "public") : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// server/_core/security.ts
import { createHash as createHash3 } from "node:crypto";
import { hostname } from "node:os";
var INSTANCE_ID = createHash3("sha256").update(hostname()).digest("hex").slice(0, 8);
function buildCsp(env = process.env) {
  const origins = /* @__PURE__ */ new Set(["'self'"]);
  try {
    if (env.OIDC_ISSUER) origins.add(new URL(env.OIDC_ISSUER).origin);
  } catch {
  }
  for (const o of (env.CSP_CONNECT_EXTRA ?? "").split(/\s+/).filter(Boolean)) {
    try {
      origins.add(new URL(o).origin);
    } catch {
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "font-src 'self' data:",
    `connect-src ${[...origins].join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}
var CSP = buildCsp();
var allowedOrigins = () => new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
function securityHeaders(_req, res, next) {
  res.setHeader("Content-Security-Policy", buildCsp());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  res.setHeader("X-Instance", INSTANCE_ID);
  res.removeHeader("X-Powered-By");
  next();
}
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, traceparent, x-request-id, x-trace-id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "x-trace-id, x-request-id");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
function sameOriginForCookies(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    res.status(403).json({ error: "bad origin" });
    return;
  }
  if (host === req.headers.host || allowedOrigins().has(origin)) return next();
  res.status(403).json({ error: "cross-origin request rejected" });
}
function assertProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  const problems = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /demo|change/i.test(env.JWT_SECRET)) problems.push("JWT_SECRET must be set to a random value of at least 32 characters");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");
  if (!env.OIDC_ISSUER && env.ALLOW_DEMO_LOGIN !== "1" && !env.OAUTH_SERVER_URL) problems.push("configure OIDC_ISSUER/OIDC_AUDIENCE (or explicitly ALLOW_DEMO_LOGIN=1 for a demo deployment)");
  if (problems.length) throw new Error(`Unsafe production configuration:
 - ${problems.join("\n - ")}`);
}

// server/infra/freshRead.ts
var FreshRead = class {
  constructor(load, now = () => performance.now()) {
    this.load = load;
    this.now = now;
  }
  running = null;
  queued = null;
  loads = 0;
  read(after) {
    if (this.running && this.running.startedAt >= after) return this.running.promise;
    if (!this.queued) {
      const settle = this.running ? this.running.promise.then(() => void 0, () => void 0) : Promise.resolve();
      this.queued = settle.then(() => {
        this.queued = null;
        return this.start();
      });
    }
    return this.queued;
  }
  start() {
    this.loads++;
    const promise = this.load();
    const entry = { startedAt: this.now(), promise };
    this.running = entry;
    const clear = () => {
      if (this.running === entry) this.running = null;
    };
    promise.then(clear, clear);
    return promise;
  }
};

// server/realtime/gateway.ts
function registerRealtimeGateway(app, opt) {
  const heartbeatMs = opt.heartbeatMs ?? 15e3;
  const maxAgeMs = opt.maxAgeMs ?? 15 * 6e4;
  const maxScopes = opt.maxScopes ?? 50;
  const perPrincipal = opt.maxConnectionsPerPrincipal ?? Number(process.env.RT_MAX_PER_PRINCIPAL ?? 20);
  const maxConnections = opt.maxConnections ?? Number(process.env.RT_MAX_CONNECTIONS ?? 5e4);
  const resolve = opt.resolve ?? ((req) => resolveIdentity(req));
  const head = opt.store.feedHead ? new FreshRead(() => opt.store.feedHead()) : null;
  const open = /* @__PURE__ */ new Map();
  let total = 0;
  app.get("/api/realtime/stream", async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      m.rtErrors.inc();
      if (!res.headersSent) res.status(503).set("Retry-After", "2").json({ error: "temporarily unavailable" });
      else if (!res.writableEnded) res.end();
      opt.onError?.(e);
    }
  });
  async function handle(req, res) {
    const identity = await resolve(req);
    if (!identity) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const principal = identity.principal;
    if (total >= maxConnections) {
      res.status(503).set("Retry-After", "5").json({ error: "at capacity" });
      return;
    }
    if ((open.get(principal.id) ?? 0) >= perPrincipal) {
      res.status(429).json({ error: "too many streams" });
      return;
    }
    const requested = String(req.query.scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (requested.length === 0 || requested.length > maxScopes || !requested.every(isValidScope)) {
      res.status(400).json({ error: `1-${maxScopes} valid scopes required` });
      return;
    }
    const restricted = workspaceRestriction(principal) !== null;
    const projectIds = restricted ? requested.filter((s) => s.startsWith("project:")).map((s) => Number(s.slice(8))).filter(Number.isInteger) : [];
    const known = projectIds.length ? await opt.store.versions(projectIds) : /* @__PURE__ */ new Map();
    const accepted = [];
    const denied = [];
    for (const s of requested) {
      let ok = canSubscribe(principal, s);
      if (ok && restricted && s.startsWith("project:")) {
        const v = known.get(Number(s.slice(8)));
        ok = !!v && canViewProject(principal, { bahnhofsmanagement: v.bahnhofsmanagement });
      }
      (ok ? accepted : denied).push(s);
    }
    if (accepted.length === 0) {
      res.status(403).json({ error: "no authorized scopes", denied });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-trace-id": traceIdFrom(req.headers)
    });
    res.write("retry: 3000\n\n");
    const frame = (event, data, id) => res.write(`${id ? `id: ${id}
` : ""}event: ${event}
data: ${JSON.stringify(data)}

`);
    const abort = new AbortController();
    total++;
    m.rtConnections.add(1);
    m.rtReconnects.inc();
    open.set(principal.id, (open.get(principal.id) ?? 0) + 1);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(hb);
      clearTimeout(age);
      abort.abort();
      total--;
      m.rtConnections.add(-1);
      const n = (open.get(principal.id) ?? 1) - 1;
      if (n <= 0) open.delete(principal.id);
      else open.set(principal.id, n);
      if (!res.writableEnded) res.end();
    };
    req.on("close", finish);
    res.on("error", finish);
    const hb = setInterval(() => res.write(": hb\n\n"), heartbeatMs);
    const age = setTimeout(() => {
      frame("reconnect", { reason: "max-age" });
      finish();
    }, maxAgeMs);
    hb.unref?.();
    age.unref?.();
    const iterator = opt.subscriber.subscribe({ channels: accepted, signal: abort.signal })[Symbol.asyncIterator]();
    const subscribedAt = performance.now();
    const headSeq = await head?.read(subscribedAt).catch(() => void 0) ?? null;
    frame("hello", { serverTime: (/* @__PURE__ */ new Date()).toISOString(), scopes: accepted, denied, headSeq });
    try {
      for (; ; ) {
        const { value, done } = await iterator.next();
        if (done || finished) break;
        if (value === OVERFLOW) {
          frame("resync", { reason: "overflow" });
          break;
        }
        const visible = eventForPrincipal(principal, value);
        if (!visible) continue;
        m.rtEventAgeMs.observe(Math.max(0, Date.now() - Date.parse(visible.timestamp)));
        m.rtDelivered.inc();
        const ok = frame("domain", visible, visible.eventId);
        if (!ok) await new Promise((r) => res.once("drain", r).once("close", r));
      }
    } finally {
      await iterator.return?.();
      finish();
    }
  }
}
function registerPresenceRoutes(app, opt) {
  const resolve = opt.resolve ?? ((req) => resolveIdentity(req));
  const authorize = async (req, res, scopeKey) => {
    const identity = await resolve(req);
    if (!identity) {
      res.status(401).json({ error: "unauthenticated" });
      return null;
    }
    const p = identity.principal;
    if (typeof scopeKey !== "string" || !isValidScope(scopeKey) || !canSubscribe(p, scopeKey)) {
      res.status(403).json({ error: "scope not allowed" });
      return null;
    }
    let workspace = null;
    if (scopeKey.startsWith("project:")) {
      const id = Number(scopeKey.slice(8));
      const v = Number.isInteger(id) ? (await opt.store.versions([id])).get(id) : void 0;
      if (!v || !canViewProject(p, { bahnhofsmanagement: v.bahnhofsmanagement })) {
        res.status(403).json({ error: "scope not allowed" });
        return null;
      }
      workspace = v.bahnhofsmanagement;
    } else if (scopeKey.startsWith("workspace:")) workspace = null;
    return { principal: p, workspace };
  };
  const guard = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      m.rtErrors.inc();
      opt.onError?.(e);
      if (!res.headersSent) res.status(503).json({ error: "temporarily unavailable" });
    }
  };
  app.post("/api/realtime/presence", guard(async (req, res) => {
    const { scope: sc, state, tabId } = req.body ?? {};
    if (!PRESENCE_STATES.includes(state) || typeof tabId !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(tabId)) {
      res.status(400).json({ error: "invalid presence" });
      return;
    }
    const a = await authorize(req, res, sc);
    if (!a) return;
    await opt.presence.heartbeat(sc, { userId: a.principal.id, name: a.principal.name, tabId, state }, a.workspace);
    res.status(204).end();
  }));
  app.delete("/api/realtime/presence", guard(async (req, res) => {
    const a = await authorize(req, res, req.query.scope);
    if (!a) return;
    const tabId = String(req.query.tabId ?? "");
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(tabId)) {
      res.status(400).json({ error: "invalid tab" });
      return;
    }
    await opt.presence.leave(req.query.scope, a.principal.id, tabId, a.workspace);
    res.status(204).end();
  }));
  app.get("/api/realtime/presence", guard(async (req, res) => {
    const a = await authorize(req, res, req.query.scope);
    if (!a) return;
    res.json({ scope: req.query.scope, members: await opt.presence.list(req.query.scope) });
  }));
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  assertProductionConfig();
  process.on("unhandledRejection", (reason) => {
    m.unhandled.inc();
    console.error("[unhandledRejection]", reason);
  });
  const app = express2();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors);
  app.use(sameOriginForCookies);
  app.use(express2.json({ limit: "256kb" }));
  app.use(express2.urlencoded({ limit: "256kb", extended: false }));
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: process.env.npm_package_version ?? "unknown",
      uptime: Math.round(process.uptime())
    });
  });
  const services2 = await getServices();
  app.get("/api/ready", async (_req, res) => {
    try {
      if (!services2) throw new Error("no database configured");
      await services2.pool.query("SELECT 1");
      res.status(200).json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.get("/api/metrics", (req, res) => {
    const token = process.env.METRICS_TOKEN;
    if (!token || req.headers.authorization !== `Bearer ${token}`) {
      res.status(404).end();
      return;
    }
    res.type("text/plain; version=0.0.4").send(renderMetrics());
  });
  if (services2) {
    registerRealtimeGateway(app, { subscriber: services2.subscriber, store: services2.store });
    registerPresenceRoutes(app, { presence: services2.presence, store: services2.store, onError: (e) => console.error("[presence]", e) });
  }
  const requirePrincipal = (allow) => async (req, res, next) => {
    const id = await resolveIdentity(req);
    if (!id) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!allow(id.principal)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
  app.use("/api/export", requirePrincipal(canExport));
  app.use("/api/import", requirePrincipal(isAdmin));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerExcelRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite-WDDAV25V.js");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const isDev = process.env.NODE_ENV === "development";
  const port = isDev ? await findAvailablePort(preferredPort) : preferredPort;
  if (isDev && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received \u2014 draining connections`);
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 5e3).unref();
    server.close(async (err) => {
      await services2?.shutdown().catch(() => {
      });
      await closeDb().catch(() => {
      });
      if (err) {
        console.error("Error during shutdown:", err);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Shutdown timed out \u2014 forcing exit");
      process.exit(1);
    }, 1e4).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
startServer().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
