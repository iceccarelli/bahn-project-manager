/** Wire contract of the ITK Prüfbericht import and reads (`pruefberichte.*`). */
import { z } from "zod";
import type { Pruefbericht } from "./pruefbericht-import";

/** Every field of a Prüfbericht except year/layout, in column order. The store builds its SQL from this, so a field cannot be added to one side only. */
export const PRUEFBERICHT_FIELDS = [
  "laufendeNummer", "datum", "taetigkeitsbereich", "artDerBaumassnahme", "ebaAktenzeichen", "bahnhofStrecke",
  "zustaendigeEbaAussenstelle", "artDerTechnik", "bauformBezeichnung", "technik", "abgeschlossen", "projektnummer",
  "zustaendigerPl", "zustaendigerFs", "termin", "beschriftung", "link", "projektname", "fabrikat", "faa", "phase",
  "pbVorhanden", "erneutePruefungErforderlich", "agPl", "anPl", "abschlusstermin", "planungsbuero", "planer", "gesamtbewertung",
] as const satisfies readonly (keyof Pruefbericht)[];

/** Column widths, equal to drizzle/schema.ts `itk_pruefberichte`. */
const text = (max: number) => z.string().max(max).nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

export const PruefberichtSchema = z.object({
  year: z.number().int().min(1990).max(2100),
  laufendeNummer: z.string().min(1).max(32),
  layout: z.enum(["2020+", "2018-2019", "2017"]),
  datum: day,
  taetigkeitsbereich: text(128),
  artDerBaumassnahme: text(128),
  ebaAktenzeichen: text(128),
  bahnhofStrecke: text(512),
  zustaendigeEbaAussenstelle: text(128),
  artDerTechnik: text(256),
  bauformBezeichnung: text(256),
  technik: text(64),
  abgeschlossen: text(64),
  projektnummer: text(64),
  zustaendigerPl: text(128),
  zustaendigerFs: text(128),
  termin: day,
  beschriftung: text(600),
  link: text(1024),
  projektname: text(512),
  fabrikat: text(128),
  faa: text(64),
  phase: text(64),
  pbVorhanden: text(16),
  erneutePruefungErforderlich: text(16),
  agPl: text(128),
  anPl: text(128),
  abschlusstermin: text(16),
  planungsbuero: text(256),
  planer: text(256),
  gesamtbewertung: text(16),
}) satisfies z.ZodType<Pruefbericht>;

/** The API body limit is 256 kB; 250 rows of a workbook stay well inside it. */
export const IMPORT_BATCH_SIZE = 250;

export const ImportBatchInputSchema = z.object({
  /** Free text naming where the rows came from (file name); stored in the audit entry. */
  source: z.string().trim().min(1).max(200),
  part: z.object({ index: z.number().int().min(1), total: z.number().int().min(1) }),
  records: z.array(PruefberichtSchema).min(1).max(400),
});
export type ImportBatchInput = z.infer<typeof ImportBatchInputSchema>;

export interface ImportBatchResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export const ListInputSchema = z.object({
  /** only reports with / without a project (the PDF-Codes and Projektübersicht ITK tabs) */
  verknuepfung: z.enum(["verknuepft", "offen"]).optional(),
  /** only the reports linked to this project */
  projectId: z.number().int().positive().optional(),
  /** Opaque keyset cursor `<year>:<id>` from the previous page. */
  cursor: z.string().regex(/^\d{4}:\d+$/).optional(),
  limit: z.number().int().min(1).max(200).default(100),
  year: z.number().int().min(1990).max(2100).optional(),
  /** The Technik of the installation (`technikArt`, see shared/itk/vocab.ts) — not the free-text product column. */
  technik: z.string().trim().min(1).max(64).optional(),
  abgeschlossen: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListInput = z.infer<typeof ListInputSchema>;

export interface PruefberichtRow extends Pruefbericht {
  id: number;
  version: number;
  /** The canonical project this report is linked to (null = not linked); see drizzle/schema.ts `itk_pruefberichte.projectId`. */
  projectId: number | null;
  projectLinkSource: "auto" | "manual" | null;
  /** Derived on import from the layout's Technik column (technikArtOf); what the filters and the Technik-Übersicht use. */
  technikArt: string | null;
}

/** A list row also names its project, so the table needs no second lookup. */
export interface PruefberichtListRow extends PruefberichtRow {
  project: { projektnummer: string | null; station: string | null } | null;
}

export interface PruefberichtPage {
  rows: PruefberichtListRow[];
  nextCursor: string | null;
}

const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

/** Set (projectId) or clear (null) the project of ONE report. `expectedVersion` is the report's version the caller saw. */
export const SetLinkInputSchema = z.object({
  id: z.number().int().positive(),
  expectedVersion: z.number().int().min(1),
  projectId: z.number().int().positive().nullable(),
  idempotencyKey,
});
export type SetLinkInput = z.infer<typeof SetLinkInputSchema>;
export interface SetLinkResult {
  id: number;
  projectId: number | null;
  version: number;
  replayed: boolean;
}

/** Link every unlinked report whose evidence identifies exactly one project (admin). `dryRun` only reports. */
export const AutoLinkInputSchema = z.object({ dryRun: z.boolean(), idempotencyKey });
export type AutoLinkInput = z.infer<typeof AutoLinkInputSchema>;
export interface AutoLinkResult {
  dryRun: boolean;
  examined: number;
  /** linked (or, in a dry run, linkable) */
  linked: number;
  /** more than one project fits: a person picks. At most 50 are listed. */
  ambiguous: { count: number; samples: Array<{ id: number; year: number; laufendeNummer: string; candidates: number }> };
  /** reason → number of reports left unlinked (no Projektnummer, no such project, station differs, …) */
  unmatched: Record<string, number>;
  replayed: boolean;
}

export interface LinkCandidate {
  projectId: number;
  projektnummer: string | null;
  station: string | null;
  projektbeschreibung: string | null;
  projektstand: string | null;
  bahnhofsmanagement: string | null;
  /** both Projektnummer and station agree, or only the Projektnummer does */
  evidence: "projektnummer+station" | "projektnummer";
}
export interface LinkCandidates {
  verdict: "unique" | "ambiguous" | "unmatched";
  /** why no automatic link (null for `unique`/`ambiguous`) */
  reason: string | null;
  candidates: LinkCandidate[];
}
