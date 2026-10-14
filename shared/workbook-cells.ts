/**
 * Cell-level helpers for reading German Excel workbooks, shared by BOTH workbook importers (the Übersichtsliste in
 * shared/register and the Prüfbericht workbook in shared/itk). They know nothing about either domain: header folding, Excel
 * serial dates, text dates. Each importer re-exports or imports from here; neither imports the other.
 */
import { parseStoredDate } from "./date";

type Cell = unknown;
type Grid = readonly (readonly Cell[])[];

/** One sheet as a cell grid (`sheet_to_json(ws, { header: 1, raw: true })`). */
export interface SheetInput {
  name: string;
  rows: Grid;
}

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

