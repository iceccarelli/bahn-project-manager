/**
 * Reads the Prüfstelle's workbook ("Projektübersicht ITK.xlsx": one sheet per
 * year, three layouts over the years) into Prüfbericht records — and into a
 * report that says exactly what was and was not understood.
 *
 * Why header-driven
 * -----------------
 * The platform's own seed script reads fixed column numbers and contradicts its
 * own docstring (it takes "Technik" from the Bauform column and "abgeschlossen"
 * from the Technik column, and never reads column L). Positions are a guess
 * about a workbook people edit; headers are what the workbook says. A column is
 * mapped when its header is recognised, and an unrecognised header is *listed*,
 * not dropped. A sheet whose key columns cannot be found is not imported; it is
 * reported as such.
 *
 * Fidelity rules
 * --------------
 *  - values are stored as found (trimmed, whitespace collapsed); a Technik or
 *    abgeschlossen the vocabulary does not know is counted in the report, not
 *    corrected
 *  - a row is skipped only for a reason that is written to the report, with its
 *    sheet and row number; blank rows are counted, not listed
 *  - duplicate (year, laufende Nummer): the first is kept, every later one is
 *    reported — nothing is merged silently
 *  - dates: Excel serial numbers and German text dates are converted without
 *    touching the time zone; the legacy "yyyymmdd" integers are parsed as such
 *
 * Pure: takes the cell grid per sheet (`sheet_to_json(ws, { header: 1, raw: true })`),
 * so the same code runs in the browser, in the CLI and in tests.
 */
import { parseStoredDate } from "../date";
import { generateLegacyPdfCode, generatePdfCode, samePdfCode } from "./pdf-code";
import { isAbgeschlossen, isItkTechnik } from "./vocab";

export type PruefberichtLayout = "2020+" | "2018-2019" | "2017";

export interface Pruefbericht {
  year: number;
  /** "25.001" (2020+), "901" (2018–2019), the Projektnr (2017). Unique per year. */
  laufendeNummer: string;
  layout: PruefberichtLayout;
  datum: string | null;
  taetigkeitsbereich: string | null;
  artDerBaumassnahme: string | null;
  ebaAktenzeichen: string | null;
  bahnhofStrecke: string | null;
  zustaendigeEbaAussenstelle: string | null;
  artDerTechnik: string | null;
  bauformBezeichnung: string | null;
  technik: string | null;
  abgeschlossen: string | null;
  projektnummer: string | null;
  zustaendigerPl: string | null;
  zustaendigerFs: string | null;
  termin: string | null;
  /** The PDF-Code as the workbook holds it. Kept to be compared with `generatePdfCode`, not shown as a second truth. */
  beschriftung: string | null;
  link: string | null;
  // legacy columns (2017–2019)
  projektname: string | null;
  fabrikat: string | null;
  faa: string | null;
  phase: string | null;
  pbVorhanden: string | null;
  erneutePruefungErforderlich: string | null;
  agPl: string | null;
  anPl: string | null;
  gesamtbewertung: string | null;
}

type Field = Exclude<keyof Pruefbericht, "year" | "layout">;
type Cell = unknown;
type Grid = readonly (readonly Cell[])[];

export interface SheetInput {
  name: string;
  rows: Grid;
}

/** ---- text and value helpers --------------------------------------------------------------------------------- */

export function foldHeader(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

function text(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Excel serial → ISO day, in UTC arithmetic only (no local time zone anywhere). Valid range 1900-03-01…2200. */
export function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 61 || serial > 109_000) return null;
  return new Date(EXCEL_EPOCH + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

function validIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** A date cell: Excel serial, yyyymmdd integer, or text ("22.03.25", "22.03.2025", "2025-03-22"). */
export function dayFromCell(v: Cell): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 19_000_101 && v <= 21_001_231) {
      return validIso(Math.floor(v / 10_000), Math.floor((v % 10_000) / 100), v % 100);
    }
    return serialToIso(v);
  }
  const t = String(v).trim();
  if (/^\d{8}$/.test(t)) return validIso(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)));
  // "22.03.25" — the platform reads this with %d.%m.%y. The workbook spans 2017–2026, so yy is 20yy.
  const short = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(t);
  if (short) return validIso(2000 + Number(short[3]), Number(short[2]), Number(short[1]));
  return parseStoredDate(t).iso;
}

/** ---- header recognition ------------------------------------------------------------------------------------- */

interface Alias {
  field: Field;
  exact?: readonly string[];
  prefix?: readonly string[];
}

const ALIASES_2020: readonly Alias[] = [
  { field: "laufendeNummer", exact: ["laufendenummer", "lfdnr", "lfdnummer", "laufendenr"] },
  { field: "datum", exact: ["datum"] },
  { field: "taetigkeitsbereich", exact: ["taetigkeitsbereich"] },
  { field: "artDerBaumassnahme", exact: ["artderbaumassnahme"] },
  { field: "ebaAktenzeichen", exact: ["ebaaktenzeichen"] },
  { field: "bahnhofStrecke", exact: ["bfstreckenbezeichnung", "bahnhofstrecke", "bfstrecke", "bahnhofstreckenbezeichnung"] },
  { field: "zustaendigeEbaAussenstelle", exact: ["zustaendigeebaaussenstelle"] },
  { field: "artDerTechnik", exact: ["artdertechnik"] },
  { field: "bauformBezeichnung", exact: ["bauformbezeichnung", "bauform"] },
  { field: "technik", exact: ["technik"] },
  { field: "abgeschlossen", exact: ["abgeschlossen"] },
  { field: "projektnummer", exact: ["projektnummer"] },
  { field: "zustaendigerPl", exact: ["zustaendigerpl", "zustaendigepl", "pl"] },
  { field: "zustaendigerFs", exact: ["zustaendigerfs", "zustaendigefs", "fs"] },
  { field: "termin", exact: ["termin"] },
  { field: "beschriftung", exact: ["beschriftungpdfcode", "beschriftung", "pdfcode"] },
  { field: "link", exact: ["link"] },
];

const ALIASES_2018: readonly Alias[] = [
  { field: "laufendeNummer", exact: ["pruefnr", "pruefnummer"] },
  { field: "bahnhofStrecke", exact: ["bahnhofsname", "bahnhofname"] },
  { field: "projektname", exact: ["projektname"] },
  { field: "technik", exact: ["technik"] },
  { field: "fabrikat", exact: ["fabrikat"] },
  { field: "faa", exact: ["faa"] },
  { field: "phase", exact: ["vepepapfertigstellung", "phase"] },
  { field: "datum", prefix: ["abgabedat"] },
  { field: "pbVorhanden", exact: ["pbvorhanden"] },
  { field: "erneutePruefungErforderlich", exact: ["erneutepruefungerforderlich"] },
  { field: "abgeschlossen", exact: ["abgeschlossen"] },
  { field: "agPl", exact: ["agpl"] },
  { field: "anPl", exact: ["anpl"] },
  { field: "beschriftung", exact: ["pdfcode", "beschriftung"] },
  { field: "gesamtbewertung", exact: ["gesamtbewertung"] },
];

const ALIASES_2017: readonly Alias[] = [
  { field: "laufendeNummer", exact: ["projektnr", "projektnummer"] },
  { field: "projektname", exact: ["projektname"] },
  { field: "bahnhofStrecke", exact: ["bahnhofname", "bahnhofsname"] },
  { field: "faa", exact: ["faa"] },
  { field: "phase", exact: ["vepepapabnahme", "phase"] },
  { field: "pbVorhanden", exact: ["pbvorhanden"] },
  { field: "datum", exact: ["abgabe"] },
  { field: "erneutePruefungErforderlich", exact: ["pruefungerforderlich"] },
  { field: "abgeschlossen", exact: ["erledigt", "abgeschlossen"] },
  { field: "agPl", exact: ["agpl"] },
];

interface LayoutSpec {
  layout: PruefberichtLayout;
  aliases: readonly Alias[];
  /** The columns without which the sheet is not this layout. */
  required: readonly Field[];
}

/** Tried in this order: the more specific layouts first would misfire on shared names, so the key columns decide. */
const LAYOUTS: readonly LayoutSpec[] = [
  { layout: "2020+", aliases: ALIASES_2020, required: ["laufendeNummer", "taetigkeitsbereich", "bahnhofStrecke"] },
  { layout: "2018-2019", aliases: ALIASES_2018, required: ["laufendeNummer", "bahnhofStrecke", "phase"] },
  { layout: "2017", aliases: ALIASES_2017, required: ["laufendeNummer", "bahnhofStrecke", "erneutePruefungErforderlich"] },
];

const HEADER_SCAN_ROWS = 25;

function fieldFor(spec: LayoutSpec, folded: string): Field | null {
  if (!folded) return null;
  for (const a of spec.aliases) {
    if (a.exact?.includes(folded) || a.prefix?.some((p) => folded.startsWith(p))) return a.field;
  }
  return null;
}

interface HeaderHit {
  spec: LayoutSpec;
  row: number;
  columns: Map<Field, number>;
  headers: Map<Field, string>;
  unmapped: string[];
}

function findHeader(rows: Grid): HeaderHit | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const cells = rows[r] ?? [];
    for (const spec of LAYOUTS) {
      const columns = new Map<Field, number>();
      const headers = new Map<Field, string>();
      const unmapped: string[] = [];
      cells.forEach((cell, c) => {
        const raw = text(cell);
        if (raw === null) return;
        const f = fieldFor(spec, foldHeader(raw));
        if (f && !columns.has(f)) {
          columns.set(f, c);
          headers.set(f, raw);
        } else unmapped.push(raw);
      });
      if (spec.required.every((f) => columns.has(f))) return { spec, row: r, columns, headers, unmapped };
    }
  }
  return null;
}

/** ---- result types ------------------------------------------------------------------------------------------- */

export interface SkippedRow {
  row: number;
  reason: string;
  value?: string;
}

export interface SheetReport {
  sheet: string;
  year: number | null;
  layout: PruefberichtLayout | null;
  /** 1-based row of the header, null when the sheet was not recognised. */
  headerRow: number | null;
  /** field → the header text it was recognised from */
  mapped: Record<string, string>;
  /** header cells present in the sheet that no field claimed */
  unmappedHeaders: string[];
  rows: number;
  imported: number;
  blank: number;
  skipped: SkippedRow[];
  warnings: string[];
}

export interface CountMap {
  [value: string]: number;
}

export interface ImportReport {
  sheets: SheetReport[];
  /** Sheets that are not year sheets (reference data such as stations, master list, lookups). */
  ignoredSheets: string[];
  totals: { imported: number; skipped: number; blank: number; duplicates: number };
  duplicates: { year: number; laufendeNummer: string; rows: number[] }[];
  /** Values the vocabularies do not know, with how often they occur. They are stored as found. */
  vocabulary: { technikUnknown: CountMap; abgeschlossenUnknown: CountMap; technikEmpty: number; abgeschlossenEmpty: number };
  /** The formula in pdf-code.ts against the codes stored in the workbook. */
  pdfCode: {
    checked: number;
    match: number;
    mismatch: number;
    noStoredCode: number;
    samples: { year: number; laufendeNummer: string; stored: string; generated: string | null }[];
  };
}

export interface ImportResult {
  records: Pruefbericht[];
  report: ImportReport;
}

const SAMPLE_LIMIT = 10;
const YEAR_SHEET = /^(20\d{2}|19\d{2})$/;

const EMPTY_RECORD: Omit<Pruefbericht, "year" | "layout" | "laufendeNummer"> = {
  datum: null, taetigkeitsbereich: null, artDerBaumassnahme: null, ebaAktenzeichen: null, bahnhofStrecke: null,
  zustaendigeEbaAussenstelle: null, artDerTechnik: null, bauformBezeichnung: null, technik: null, abgeschlossen: null,
  projektnummer: null, zustaendigerPl: null, zustaendigerFs: null, termin: null, beschriftung: null, link: null,
  projektname: null, fabrikat: null, faa: null, phase: null, pbVorhanden: null, erneutePruefungErforderlich: null,
  agPl: null, anPl: null, gesamtbewertung: null,
};

const DATE_FIELDS: ReadonlySet<Field> = new Set(["datum", "termin"]);

/** ---- the import --------------------------------------------------------------------------------------------- */

function readRecord(hit: HeaderHit, row: readonly Cell[], year: number): { record: Pruefbericht; numericNumber: boolean } | { skip: string; value?: string } {
  const get = (f: Field): Cell => {
    const c = hit.columns.get(f);
    return c === undefined ? null : row[c];
  };
  let nr: string | null;
  const rawNr = get("laufendeNummer");
  switch (hit.spec.layout) {
    case "2018-2019": {
      // Prüfnr is a number; a text cell here is a heading or a note, not a report.
      if (typeof rawNr !== "number" || !Number.isFinite(rawNr)) return { skip: "Prüfnr. ist keine Zahl", value: text(rawNr) ?? undefined };
      nr = String(Math.trunc(rawNr));
      break;
    }
    case "2020+": {
      nr = text(rawNr);
      if (nr === null) return { skip: "keine laufende Nummer" };
      if (!nr.includes(".")) return { skip: "laufende Nummer ohne Punkt (erwartet z. B. 25.001)", value: nr };
      break;
    }
    default:
      nr = text(rawNr);
      if (nr === null) return { skip: "keine Projektnummer" };
  }

  const rec: Pruefbericht = { ...EMPTY_RECORD, year, layout: hit.spec.layout, laufendeNummer: nr };
  for (const f of hit.columns.keys()) {
    if (f === "laufendeNummer") continue;
    const v = get(f);
    (rec as unknown as Record<string, string | null>)[f] = DATE_FIELDS.has(f) ? dayFromCell(v) : text(v);
  }
  // The platform maps AG PL to the unified "zuständiger PL" for the legacy layouts; so does this.
  if (hit.spec.layout !== "2020+" && rec.zustaendigerPl === null) rec.zustaendigerPl = rec.agPl;
  return { record: rec, numericNumber: hit.spec.layout === "2020+" && typeof rawNr === "number" };
}

export function importWorkbookSheets(sheets: readonly SheetInput[]): ImportResult {
  const records: Pruefbericht[] = [];
  const reports: SheetReport[] = [];
  const ignoredSheets: string[] = [];
  const seen = new Map<string, number[]>();
  const numericNumbers = new Map<string, number[]>();
  const duplicates = new Map<string, { year: number; laufendeNummer: string; rows: number[] }>();
  const technikUnknown: CountMap = {};
  const abgeschlossenUnknown: CountMap = {};
  let technikEmpty = 0;
  let abgeschlossenEmpty = 0;
  const pdf = { checked: 0, match: 0, mismatch: 0, noStoredCode: 0, samples: [] as ImportReport["pdfCode"]["samples"] };

  for (const sheet of sheets) {
    const name = sheet.name.trim();
    if (!YEAR_SHEET.test(name)) {
      ignoredSheets.push(sheet.name);
      continue;
    }
    const year = Number(name);
    const report: SheetReport = {
      sheet: name, year, layout: null, headerRow: null, mapped: {}, unmappedHeaders: [],
      rows: 0, imported: 0, blank: 0, skipped: [], warnings: [],
    };
    reports.push(report);

    const hit = findHeader(sheet.rows);
    if (!hit) {
      report.warnings.push("Kopfzeile nicht erkannt: kein Blatt-Layout (2020+, 2018–2019, 2017) passt — Blatt nicht importiert");
      continue;
    }
    report.layout = hit.spec.layout;
    report.headerRow = hit.row + 1;
    report.mapped = Object.fromEntries(hit.headers);
    report.unmappedHeaders = hit.unmapped;
    const missingOptional = hit.spec.aliases.map((a) => a.field).filter((f) => !hit.columns.has(f));
    if (missingOptional.length) report.warnings.push(`Spalten nicht gefunden (Wert bleibt leer): ${[...new Set(missingOptional)].join(", ")}`);

    for (let r = hit.row + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      report.rows += 1;
      if (row.every((c) => text(c) === null)) {
        report.blank += 1;
        continue;
      }
      const out = readRecord(hit, row, year);
      if ("skip" in out) {
        report.skipped.push({ row: r + 1, reason: out.skip, ...(out.value ? { value: out.value } : {}) });
        continue;
      }
      const rec = out.record;
      if (out.numericNumber) {
        const list = numericNumbers.get(name) ?? [];
        list.push(r + 1);
        numericNumbers.set(name, list);
      }
      const key = `${year}|${rec.laufendeNummer}`;
      const prior = seen.get(key);
      if (prior) {
        prior.push(r + 1);
        report.skipped.push({ row: r + 1, reason: `Duplikat von Zeile ${prior[0]} (erste Zeile bleibt, diese wird nicht übernommen)`, value: rec.laufendeNummer });
        const d = duplicates.get(key) ?? { year, laufendeNummer: rec.laufendeNummer, rows: prior.slice(0, 1) };
        d.rows.push(r + 1);
        duplicates.set(key, d);
        continue;
      }
      seen.set(key, [r + 1]);

      if (rec.layout === "2020+" && !rec.laufendeNummer.startsWith(`${String(year).slice(2)}.`)) {
        report.warnings.push(`Zeile ${r + 1}: laufende Nummer ${rec.laufendeNummer} passt nicht zum Blatt ${year}`);
      }

      if (rec.technik === null) technikEmpty += 1;
      else if (!isItkTechnik(rec.technik)) technikUnknown[rec.technik] = (technikUnknown[rec.technik] ?? 0) + 1;
      if (rec.abgeschlossen === null) abgeschlossenEmpty += 1;
      else if (!isAbgeschlossen(rec.abgeschlossen)) abgeschlossenUnknown[rec.abgeschlossen] = (abgeschlossenUnknown[rec.abgeschlossen] ?? 0) + 1;

      if (rec.layout !== "2017") {
        const generated =
          rec.layout === "2020+"
            ? generatePdfCode(rec.taetigkeitsbereich, rec.laufendeNummer, rec.bahnhofStrecke)
            : generateLegacyPdfCode(rec.laufendeNummer, rec.bahnhofStrecke, rec.technik, rec.phase);
        if (rec.beschriftung === null) pdf.noStoredCode += 1;
        else {
          pdf.checked += 1;
          if (samePdfCode(rec.beschriftung, generated)) pdf.match += 1;
          else {
            pdf.mismatch += 1;
            if (pdf.samples.length < SAMPLE_LIMIT) pdf.samples.push({ year, laufendeNummer: rec.laufendeNummer, stored: rec.beschriftung, generated });
          }
        }
      }

      records.push(rec);
      report.imported += 1;
    }
  }

  // A numeric cell cannot say whether it was "25.010" or "25.01": the trailing zero is already gone.
  for (const rep of reports) {
    const rows = numericNumbers.get(rep.sheet);
    if (rows?.length) rep.warnings.push(`${rows.length} laufende Nummern sind als Zahl gespeichert (z. B. Zeile ${rows[0]}); nachgestellte Nullen können fehlen — im Workbook als Text formatieren`);
  }

  const skipped = reports.reduce((n, s) => n + s.skipped.length, 0);
  return {
    records,
    report: {
      sheets: reports,
      ignoredSheets,
      totals: {
        imported: records.length,
        skipped,
        blank: reports.reduce((n, s) => n + s.blank, 0),
        duplicates: duplicates.size,
      },
      duplicates: [...duplicates.values()],
      vocabulary: { technikUnknown, abgeschlossenUnknown, technikEmpty, abgeschlossenEmpty },
      pdfCode: pdf,
    },
  };
}
