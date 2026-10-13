/**
 * The Technik-Übersicht / PDF-Code figures over the stored ITK Prüfberichte.
 * Pure — the server derives it over its cached rows (`pruefberichte.view`), exactly like the Jahresansicht.
 * Counts are of Prüfberichte (rows of the workbook), not of Projects.
 */
import { derivePdfCode, pdfPrefix, samePdfCode, type PdfPrefix } from "./pdf-code";
import type { Pruefbericht } from "./pruefbericht-import";
import { technikArtOf } from "./vocab";

export interface TechnikRow {
  /** The Technik of the installation (technikArtOf); null = none stated or "-" */
  technik: string | null;
  count: number;
  perYear: Record<string, number>;
  abgeschlossen: Record<string, number>;
}

export interface PruefberichtView {
  asOf: number;
  total: number;
  /** Years that have Prüfberichte, ascending. */
  years: number[];
  /** Largest first; the empty Technik last. */
  technik: TechnikRow[];
  abgeschlossen: { value: string | null; count: number }[];
  /** Tätigkeitsbereich with the PDF prefix the formula gives it. */
  taetigkeit: { name: string | null; prefix: PdfPrefix | null; count: number }[];
  /** The formula against the codes stored in the workbook, over everything that is in the database. */
  pdfCode: { derivable: number; stored: number; match: number; mismatch: number };
}

const bump = (m: Map<string | null, number>, k: string | null) => m.set(k, (m.get(k) ?? 0) + 1);
const emptyLast = <T extends { count: number }>(key: (t: T) => string | null) => (a: T, b: T) =>
  (key(a) === null ? 1 : 0) - (key(b) === null ? 1 : 0) || b.count - a.count || String(key(a)).localeCompare(String(key(b)), "de");

export function buildPruefberichtView(rows: readonly Pruefbericht[], asOf: number = Date.now()): PruefberichtView {
  const technik = new Map<string | null, TechnikRow>();
  const abgeschlossen = new Map<string | null, number>();
  const taetigkeit = new Map<string | null, number>();
  const years = new Set<number>();
  const pdf = { derivable: 0, stored: 0, match: 0, mismatch: 0 };

  for (const r of rows) {
    years.add(r.year);
    const art = technikArtOf(r);
    const t = technik.get(art) ?? { technik: art, count: 0, perYear: {}, abgeschlossen: {} };
    t.count += 1;
    t.perYear[String(r.year)] = (t.perYear[String(r.year)] ?? 0) + 1;
    const ab = r.abgeschlossen ?? "";
    t.abgeschlossen[ab] = (t.abgeschlossen[ab] ?? 0) + 1;
    technik.set(art, t);
    bump(abgeschlossen, r.abgeschlossen);
    bump(taetigkeit, r.taetigkeitsbereich);

    if (r.layout !== "2017") {
      const generated = derivePdfCode(r);
      if (generated !== null) pdf.derivable += 1;
      if (r.beschriftung !== null) {
        pdf.stored += 1;
        if (samePdfCode(r.beschriftung, generated)) pdf.match += 1;
        else pdf.mismatch += 1;
      }
    }
  }

  return {
    asOf,
    total: rows.length,
    years: [...years].sort((a, b) => a - b),
    technik: [...technik.values()].sort(emptyLast((t) => t.technik)),
    abgeschlossen: [...abgeschlossen].map(([value, count]) => ({ value, count })).sort(emptyLast((a) => a.value)),
    taetigkeit: [...taetigkeit]
      .map(([name, count]) => ({ name, prefix: name ? pdfPrefix(name) : null, count }))
      .sort(emptyLast((a) => a.name)),
    pdfCode: pdf,
  };
}
