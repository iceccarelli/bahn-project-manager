/**
 * Test support: a synthetic "Übersicht" sheet with the header layout of the real Übersichtsliste (header on Excel row 8,
 * project rows from row 9, 14 department groups of Status / Name / Datum from column J, Kommentar in AZ, "Link zum Projekt"
 * in BA, the workbook's own spelling "Baubetriebstechnnologie"). Every name, number and link is invented.
 */
import { DEPARTMENTS, type Department } from "../validation";
import type { SheetInput } from "../itk/pruefbericht-import";

export const REGISTER_HEADER: string[] = (() => {
  const h = ["Projektnummer", "Bahnhofsmanagement", "Station", "Bahnhofsnummer", "Streckennummer", "Projektbeschreibung", "Projektstand", "Projektleiter", "Termin Projektvorstellung"];
  DEPARTMENTS.forEach((d, i) => {
    h.push(d === "Baubetriebstechnologie" ? "Baubetriebstechnnologie" : d, i === 0 ? "Name" : `Name${i + 1}`, i === 0 ? "Datum" : `Datum${i + 1}`);
  });
  h.push("Kommentar", "Link zum Projekt");
  return h;
})();

export interface RowSpec {
  projektnummer?: string | null;
  bm?: string | null;
  station?: string | null;
  bahnhofsnummer?: string | number | null;
  strecke?: string | number | null;
  beschreibung?: string | null;
  stand?: string | null;
  pl?: string | null;
  termin?: unknown;
  /** department → [status, name, datum] */
  reviews?: Partial<Record<Department, [string | null, string | null, unknown]>>;
  kommentar?: string | null;
  link?: string | null;
}

export function registerRow(s: RowSpec): unknown[] {
  /** an explicit `null` means an empty cell; only an absent key takes the default */
  const d = <K extends keyof RowSpec>(k: K, fallback: RowSpec[K]): RowSpec[K] => (k in s ? s[k] : fallback);
  const r: unknown[] = [
    d("projektnummer", null), d("bm", "Kassel"), d("station", "Teststadt"), d("bahnhofsnummer", null), d("strecke", null),
    d("beschreibung", "Umbau Testbahnsteig"), d("stand", "AP"), d("pl", "Pia Projektleitung"), d("termin", 45_000),
  ];
  for (const d of DEPARTMENTS) {
    const g = s.reviews?.[d] ?? ["nicht erforderlich", null, null];
    r.push(g[0], g[1], g[2]);
  }
  r.push(s.kommentar ?? null, s.link ?? null);
  return r;
}

/** Excel serial of 2023-03-15, used as the default Termin. */
export const SERIAL_2023_03_15 = 45_000;

/** rows 1–7 carry other content in the real file (a title, filters); the header is row 8. */
export function registerSheet(rows: unknown[][], name = "Übersicht"): SheetInput {
  const lead: unknown[][] = [["Übersichtsliste Projekte (synthetisch)"], [], [], [], [], [], []];
  return { name, rows: [...lead, [...REGISTER_HEADER], ...rows.map((r) => [...r])] };
}
