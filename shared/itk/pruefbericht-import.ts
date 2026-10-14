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
import { dayFromCell, foldHeader, serialToIso, type SheetInput } from "../workbook-cells";
export { dayFromCell, foldHeader, serialToIso, type SheetInput };
import { derivePdfCode, samePdfCode } from "./pdf-code";
import { NO_VALUE, isTechnikArt, normalizeAbgeschlossen, technikArtOf } from "./vocab";

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
  /** "1" where the sheet marks that a Abschlusstermin exists (2018–2019). */
  abschlusstermin: string | null;
  planungsbuero: string | null;
  planer: string | null;
  gesamtbewertung: string | null;
}

type Field = Exclude<keyof Pruefbericht, "year" | "layout">;
type Cell = unknown;
type Grid = readonly (readonly Cell[])[];


/** ---- text and value helpers --------------------------------------------------------------------------------- */

function text(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** ---- header recognition ------------------------------------------------------------------------------------- */

interface Alias {
  field: Field;
  exact?: readonly string[];
  prefix?: readonly string[];
}

/**
 * Headers in the real workbook are long, multi-line labels with annotations ("Ausgeübter Tätigkeitsbereich (ggf. mit
 * Hinweis auf Tutorium)", "Bf / Streckenbezeichnung / Nr. / Projektbezeichnung mit Ort [Ril100]"), so most fields are
 * recognised by the start of the folded label; short, ambiguous labels ("Technik", "Termin") must match whole.
 */
const ALIASES_2020: readonly Alias[] = [
  { field: "laufendeNummer", exact: ["laufendenummer", "lfdnr", "lfdnummer", "laufendenr"] },
  { field: "datum", prefix: ["datum"] },
  { field: "taetigkeitsbereich", prefix: ["ausgeuebtertaetigkeitsbereich", "taetigkeitsbereich"] },
  { field: "artDerBaumassnahme", prefix: ["artderbaumassnahme"] },
  { field: "ebaAktenzeichen", prefix: ["ebaaktenzeichen"] },
  { field: "bahnhofStrecke", prefix: ["bfstreckenbezeichnung", "bahnhofstrecke", "bfstrecke"] },
  { field: "zustaendigeEbaAussenstelle", prefix: ["zustaendigeebaaussenstelle"] },
  { field: "artDerTechnik", prefix: ["artdertechnik"] },
  { field: "bauformBezeichnung", prefix: ["bauform"] },
  { field: "technik", exact: ["technik"] },
  { field: "abgeschlossen", exact: ["abgeschlossen"] },
  { field: "projektnummer", exact: ["projektnummer"] },
  { field: "zustaendigerPl", exact: ["zustaendigerpl", "zustaendigepl"] },
  { field: "zustaendigerFs", exact: ["zustaendigerfs", "zustaendigefs"] },
  { field: "termin", exact: ["termin"] },
  { field: "beschriftung", prefix: ["beschriftung", "pdfcode"] },
  { field: "link", exact: ["link"] },
];

const ALIASES_2018: readonly Alias[] = [
  { field: "laufendeNummer", exact: ["pruefnr", "pruefnummer"] },
  { field: "bahnhofStrecke", prefix: ["bahnhofsname", "bahnhofname"] },
  { field: "projektname", exact: ["projektname"] },
  { field: "technik", exact: ["technik"] },
  { field: "fabrikat", exact: ["fabrikat"] },
  { field: "faa", exact: ["faa"] },
  { field: "phase", prefix: ["vepepapfertigstellung"] },
  { field: "datum", prefix: ["abgabedat"] },
  { field: "pbVorhanden", exact: ["pbvorhanden"] },
  { field: "erneutePruefungErforderlich", exact: ["erneutepruefungerforderlich"] },
  { field: "abgeschlossen", exact: ["abgeschlossen"] },
  { field: "agPl", exact: ["agpl"] },
  { field: "anPl", exact: ["anpl"] },
  { field: "beschriftung", prefix: ["pdfcode", "beschriftung"] },
  { field: "abschlusstermin", exact: ["abschlusstermin"] },
  { field: "planungsbuero", exact: ["planungsbuero"] },
  { field: "planer", exact: ["planer"] },
  { field: "gesamtbewertung", exact: ["gesamtbewertung"] },
];

const ALIASES_2017: readonly Alias[] = [
  { field: "laufendeNummer", exact: ["projektnr", "projektnummer"] },
  { field: "projektname", exact: ["projektname"] },
  { field: "bahnhofStrecke", prefix: ["bahnhofname", "bahnhofsname"] },
  { field: "faa", exact: ["faa"] },
  { field: "phase", prefix: ["vepepapabnahme"] },
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
  /** Rows with nothing in them. */
  blank: number;
  /** Pre-numbered rows ("22.206") with no other content — the sheets are numbered ahead of the work. Not reports, not imported. */
  placeholders: number;
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
  totals: { imported: number; skipped: number; blank: number; placeholders: number; duplicates: number };
  /** Numbers that occur more than once in a sheet: every row is imported, the later ones under `keptAs` ("770/2"). */
  duplicates: { year: number; laufendeNummer: string; rows: number[]; keptAs: string[] }[];
  /** Values the vocabularies do not know, with how often they occur. They are stored as found. */
  vocabulary: { technikUnknown: CountMap; abgeschlossenUnknown: CountMap; technikEmpty: number; abgeschlossenEmpty: number };
  /** The formula in pdf-code.ts against the codes stored in the workbook. */
  pdfCode: {
    checked: number;
    match: number;
    mismatch: number;
    noStoredCode: number;
    /** Per sheet: the formula changed with the layout, so the verdict is only meaningful per sheet. */
    bySheet: Record<string, { checked: number; match: number }>;
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
  agPl: null, anPl: null, abschlusstermin: null, planungsbuero: null, planer: null, gesamtbewertung: null,
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
      // A Prüfnr is a number, optionally with a letter for a sub-report ("907a", "936b"); any other text is a heading or a note.
      if (typeof rawNr === "number" && Number.isFinite(rawNr)) nr = String(Math.trunc(rawNr));
      else {
        const t = text(rawNr);
        if (t === null || !/^\d+\s?[A-Za-z]$/.test(t)) return { skip: "Prüfnr. ist keine Nummer (erwartet z. B. 907 oder 907a)", value: t ?? undefined };
        nr = t.replace(/\s+/g, "");
      }
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
  const duplicates = new Map<string, { year: number; laufendeNummer: string; rows: number[]; keptAs: string[] }>();
  const technikUnknown: CountMap = {};
  const abgeschlossenUnknown: CountMap = {};
  let technikEmpty = 0;
  let abgeschlossenEmpty = 0;
  const pdf = { checked: 0, match: 0, mismatch: 0, noStoredCode: 0, bySheet: {} as ImportReport["pdfCode"]["bySheet"], samples: [] as ImportReport["pdfCode"]["samples"] };

  for (const sheet of sheets) {
    const name = sheet.name.trim();
    if (!YEAR_SHEET.test(name)) {
      ignoredSheets.push(sheet.name);
      continue;
    }
    const year = Number(name);
    const report: SheetReport = {
      sheet: name, year, layout: null, headerRow: null, mapped: {}, unmappedHeaders: [],
      rows: 0, imported: 0, blank: 0, placeholders: 0, skipped: [], warnings: [],
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

    const keyCol = hit.columns.get("laufendeNummer");
    const dataCols = [...hit.columns].filter(([f]) => f !== "laufendeNummer" && f !== "abschlusstermin").map(([, c]) => c);
    for (let r = hit.row + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      report.rows += 1;
      // A report has content in at least one data column. A row without is not one: either nothing at all (or only a
      // pre-filled flag such as the 2018 sheet's "Abschlusstermin = 1" down to row 144), or a number the sheet was
      // numbered ahead with ("22.206" … "22.209"). Counting those as reports would invent hundreds of them.
      if (dataCols.every((c) => text(row[c]) === null)) {
        if (keyCol !== undefined && text(row[keyCol]) !== null) report.placeholders += 1;
        else report.blank += 1;
        continue;
      }
      const out = readRecord(hit, row, year);
      if ("skip" in out) {
        report.skipped.push({ row: r + 1, reason: out.skip, ...(out.value ? { value: out.value } : {}) });
        continue;
      }
      const rec = out.record;
      const original = rec.laufendeNummer;
      if (out.numericNumber) {
        const list = numericNumbers.get(name) ?? [];
        list.push(r + 1);
        numericNumbers.set(name, list);
      }
      const key = `${year}|${original}`;
      const prior = seen.get(key);
      if (prior) {
        // The same number twice in a sheet is a real thing in this workbook (2017: 770). Both rows are reports; neither
        // is dropped and neither overwrites the other — the later ones are stored as "770/2" and the report says so.
        prior.push(r + 1);
        rec.laufendeNummer = `${original}/${prior.length}`;
        const d = duplicates.get(key) ?? { year, laufendeNummer: original, rows: prior.slice(0, 1), keptAs: [] };
        d.rows.push(r + 1);
        d.keptAs.push(rec.laufendeNummer);
        duplicates.set(key, d);
        report.warnings.push(`Zeile ${r + 1}: Nummer ${original} kommt schon in Zeile ${prior[0]} vor — als ${rec.laufendeNummer} übernommen`);
      } else seen.set(key, [r + 1]);

      if (rec.layout === "2020+" && !original.startsWith(`${String(year).slice(2)}.`)) {
        report.warnings.push(`Zeile ${r + 1}: laufende Nummer ${original} passt nicht zum Blatt ${year}`);
      }

      const art = technikArtOf(rec);
      if (art === null) technikEmpty += 1;
      else if (!isTechnikArt(art)) technikUnknown[art] = (technikUnknown[art] ?? 0) + 1;
      if (rec.abgeschlossen === null || rec.abgeschlossen === NO_VALUE) abgeschlossenEmpty += 1;
      else if (normalizeAbgeschlossen(rec.abgeschlossen) === null) abgeschlossenUnknown[rec.abgeschlossen] = (abgeschlossenUnknown[rec.abgeschlossen] ?? 0) + 1;

      if (rec.layout !== "2017") {
        const generated = derivePdfCode({ ...rec, laufendeNummer: original });
        if (rec.beschriftung === null) pdf.noStoredCode += 1;
        else {
          pdf.checked += 1;
          const per = (pdf.bySheet[name] ??= { checked: 0, match: 0 });
          per.checked += 1;
          if (samePdfCode(rec.beschriftung, generated)) {
            pdf.match += 1;
            per.match += 1;
          }
          else {
            pdf.mismatch += 1;
            if (pdf.samples.length < SAMPLE_LIMIT) pdf.samples.push({ year, laufendeNummer: original, stored: rec.beschriftung, generated });
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
        placeholders: reports.reduce((n, s) => n + s.placeholders, 0),
        duplicates: duplicates.size,
      },
      duplicates: [...duplicates.values()],
      vocabulary: { technikUnknown, abgeschlossenUnknown, technikEmpty, abgeschlossenEmpty },
      pdfCode: pdf,
    },
  };
}
