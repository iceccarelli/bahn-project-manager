/** Wire contract of the ITK Prüfbericht import and reads (`pruefberichte.*`). */
import { z } from "zod";
import type { Pruefbericht } from "./pruefbericht-import";

/** Every field of a Prüfbericht except year/layout, in column order. The store builds its SQL from this, so a field cannot be added to one side only. */
export const PRUEFBERICHT_FIELDS = [
  "laufendeNummer", "datum", "taetigkeitsbereich", "artDerBaumassnahme", "ebaAktenzeichen", "bahnhofStrecke",
  "zustaendigeEbaAussenstelle", "artDerTechnik", "bauformBezeichnung", "technik", "abgeschlossen", "projektnummer",
  "zustaendigerPl", "zustaendigerFs", "termin", "beschriftung", "link", "projektname", "fabrikat", "faa", "phase",
  "pbVorhanden", "erneutePruefungErforderlich", "agPl", "anPl", "gesamtbewertung",
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
  /** Opaque keyset cursor `<year>:<id>` from the previous page. */
  cursor: z.string().regex(/^\d{4}:\d+$/).optional(),
  limit: z.number().int().min(1).max(200).default(100),
  year: z.number().int().min(1990).max(2100).optional(),
  technik: z.string().trim().min(1).max(64).optional(),
  abgeschlossen: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListInput = z.infer<typeof ListInputSchema>;

export interface PruefberichtRow extends Pruefbericht {
  id: number;
  version: number;
}

export interface PruefberichtPage {
  rows: PruefberichtRow[];
  nextCursor: string | null;
}
