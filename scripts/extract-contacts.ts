/**
 * Transcribe sheet `Hilfsdatei` of Projektanmeldung-Fachspezialistenpruefung.xlsm
 * into data/contacts.source.json, and report what the VBA does with it.
 *
 * Run:  pnpm contacts:extract
 *
 * This is the evidence step. shared/contacts.ts is hand-authored on top of the
 * JSON this produces, because the corrections it applies (see the off-by-two
 * below) are editorial decisions that belong in reviewed code, not in generated
 * output.
 */

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKBOOK = path.join(ROOT, "data", "Projektanmeldung-Fachspezialistenpruefung.xlsm");
const OUT_JSON = path.join(ROOT, "data", "contacts.source.json");
const OUT_REPORT = path.join(ROOT, "data", "contacts.report.json");

export interface HilfsdateiRow {
  row: number;
  /** Column A — the group label, e.g. "Brandschutz", "TBQ", "Darmstadt". */
  group: string;
  /** Column B — person's name. Empty on separator and placeholder rows. */
  name: string;
  /** Column C — e-mail. Empty on separator and placeholder rows. */
  mail: string;
}

/**
 * Which Hilfsdatei rows the live macro reads for each Formular trigger cell.
 * Taken from the two mail-building routines (they are near-duplicates, at
 * roughly VBA lines 200-520 and 1200-1520).
 */
export const VBA_RECIPIENT_ROWS: Record<number, number[]> = {
  17: [8, 9, 10, 11, 12],
  18: [18, 19, 20, 21],
  19: [5, 6, 7, 8, 9],
  20: [22],
  21: [16, 25, 69],
  22: [17, 26],
  23: [15],
  24: [40, 41, 42, 43, 44, 45],
  25: [23, 24, 47],
  26: [50, 51, 52, 53, 54, 55, 56, 57],
  27: [60],
  28: [38, 39, 61, 62],
  29: [63, 64, 65, 66, 67],
  30: [74, 75],
  31: [71, 72],
  32: [82, 83, 84, 85],
  33: [77, 78, 79, 80],
};

function cell(sheet: XLSX.WorkSheet, address: string): string {
  const c = sheet[address];
  if (!c) return "";
  return String(c.v ?? "").replace(/\s+/g, " ").trim();
}

export function readHilfsdatei(file = WORKBOOK): HilfsdateiRow[] {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const sheet = wb.Sheets.Hilfsdatei;
  if (!sheet) throw new Error("sheet `Hilfsdatei` not found");
  const rows: HilfsdateiRow[] = [];
  for (let r = 1; r <= 85; r++) {
    rows.push({
      row: r,
      group: cell(sheet, `A${r}`),
      name: cell(sheet, `B${r}`),
      mail: cell(sheet, `C${r}`),
    });
  }
  return rows;
}

function main() {
  const rows = readHilfsdatei();
  const byRow = new Map(rows.map((r) => [r.row, r]));

  const findings: Array<Record<string, unknown>> = [];
  for (const [formularRow, recipientRows] of Object.entries(VBA_RECIPIENT_ROWS)) {
    const resolved = recipientRows.map((n) => byRow.get(n));
    const groups = [...new Set(resolved.map((r) => r?.group).filter(Boolean))];
    const empty = recipientRows.filter((n) => !byRow.get(n)?.mail);
    findings.push({
      formularRow: Number(formularRow),
      recipientRows,
      groups,
      emptyRows: empty,
      // A trigger whose rows span more than one group label is reading into a
      // neighbouring department's block.
      spansMultipleGroups: groups.length > 1,
      reachesNobody: empty.length === recipientRows.length,
    });
  }

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(rows.filter((r) => r.group || r.name || r.mail), null, 1)}\n`);
  fs.writeFileSync(OUT_REPORT, `${JSON.stringify({ generated: "run pnpm contacts:extract", findings }, null, 1)}\n`);

  const populated = rows.filter((r) => r.mail).length;
  console.log("[extract-contacts]");
  console.log(`      ${populated} rows carry an e-mail address`);
  for (const f of findings) {
    const flags: string[] = [];
    if (f.spansMultipleGroups) flags.push(`spans ${(f.groups as string[]).join(" + ")}`);
    if (f.reachesNobody) flags.push("REACHES NOBODY");
    else if ((f.emptyRows as number[]).length) flags.push(`${(f.emptyRows as number[]).length} empty row(s)`);
    if (flags.length) console.log(`      Formular F${f.formularRow}: ${flags.join("; ")}`);
  }
  console.log(`      wrote ${path.relative(ROOT, OUT_JSON)} and ${path.relative(ROOT, OUT_REPORT)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
