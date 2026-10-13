/**
 * scripts/itk/inspect-workbook.ts — dry run of the Prüfbericht import.
 *
 *   pnpm itk:inspect "<path>/Projektübersicht ITK.xlsx" [--json]
 *
 * Reads the workbook exactly as the importer would, writes nothing, and prints
 * what was understood and what was not: the layout and header mapping per sheet,
 * rows imported / blank / skipped (with reasons), duplicates, values outside the
 * vocabularies, and — the point of running it first — how the PDF-Code formula in
 * shared/itk/pdf-code.ts compares with the codes stored in the workbook.
 *
 * Exit code: 0 when every year sheet was recognised and no row was skipped; 1 otherwise (the report says why); 2 for a usage error.
 */
import fs from "node:fs";
import * as XLSX from "xlsx";
import { importWorkbookSheets } from "../../shared/itk/pruefbericht-import";
import { sheetsFromWorkbook } from "../../shared/itk/workbook";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
if (!file || !fs.existsSync(file)) {
  console.error('usage: pnpm itk:inspect "<workbook.xlsx>" [--json]');
  process.exit(2);
}

const workbook = XLSX.read(fs.readFileSync(file), { type: "buffer" });
const { report } = importWorkbookSheets(sheetsFromWorkbook(XLSX, workbook));

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(`\nWorkbook: ${file}`);
  console.log(`Sheets: ${workbook.SheetNames.length}  (year sheets read: ${report.sheets.length}; ignored: ${report.ignoredSheets.join(", ") || "none"})\n`);
  console.log(`${pad("Blatt", 7)}${pad("Layout", 11)}${pad("Kopf", 6)}${pad("Zeilen", 8)}${pad("importiert", 12)}${pad("leer", 6)}${pad("Platzhalter", 13)}${pad("übersprungen", 14)}PDF-Code (gleich/geprüft)`);
  for (const s of report.sheets) {
    const pc = report.pdfCode.bySheet[s.sheet];
    console.log(`${pad(s.sheet, 7)}${pad(s.layout ?? "—", 11)}${pad(s.headerRow ?? "—", 6)}${pad(s.rows, 8)}${pad(s.imported, 12)}${pad(s.blank, 6)}${pad(s.placeholders, 13)}${pad(s.skipped.length, 14)}${pc ? `${pc.match}/${pc.checked}` : "—"}`);
  }
  const t = report.totals;
  console.log(`\nSumme: ${t.imported} importiert, ${t.skipped} übersprungen, ${t.duplicates} doppelte Nummern (alle übernommen), ${t.placeholders} vornummerierte Platzhalterzeilen (nicht importiert), ${t.blank} leere Zeilen`);

  for (const s of report.sheets) {
    const notes = [...s.warnings, ...s.unmappedHeaders.map((h) => `Kopfzelle ohne Feld: "${h}"`)];
    if (!notes.length && !s.skipped.length) continue;
    console.log(`\n[${s.sheet}]`);
    for (const n of notes) console.log(`  ! ${n}`);
    for (const k of s.skipped.slice(0, 8)) console.log(`  - Zeile ${k.row}: ${k.reason}${k.value ? ` (${k.value})` : ""}`);
    if (s.skipped.length > 8) console.log(`  … und ${s.skipped.length - 8} weitere übersprungene Zeilen`);
  }

  const v = report.vocabulary;
  const list = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ") || "keine";
  console.log(`\nTechnik (Bauform / Bezeichnung der Anlage) außerhalb der Liste: ${list(v.technikUnknown)}; ohne Technik: ${v.technikEmpty}`);
  console.log(`abgeschlossen außerhalb der Liste: ${list(v.abgeschlossenUnknown)}; leer: ${v.abgeschlossenEmpty}`);

  const p = report.pdfCode;
  console.log(`\nPDF-Code: ${p.checked} gespeicherte Codes geprüft — ${p.match} stimmen mit der Formel überein, ${p.mismatch} nicht; ${p.noStoredCode} Zeilen ohne gespeicherten Code`);
  if (p.checked > 0) {
    const share = Math.round((p.match / p.checked) * 100);
    console.log(share >= 95 ? `  → Die Formel (G/S/A/P + Nummer + " - " + Bahnhof) bildet die Arbeitsmappe zu ${share} % ab.` : `  → Nur ${share} % stimmen überein: Format vor dem Import klären.`);
  }
  for (const m of p.samples) console.log(`  gespeichert "${m.stored}"  ≠  berechnet "${m.generated ?? "—"}"  (${m.year}, ${m.laufendeNummer})`);
}

// Duplicated numbers are imported (and listed), placeholders are expected; what makes a run unclean is a sheet that was not understood or a row that was skipped.
const clean = report.sheets.every((s) => s.layout !== null && s.skipped.length === 0);
process.exit(clean ? 0 : 1);
