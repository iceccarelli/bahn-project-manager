/**
 * scripts/register/inspect-register.ts — dry run of the Übersichtsliste import.
 *
 *   pnpm register:inspect "<path>/Übersichtsliste.xlsm" [--itk "<path>/Projektübersicht ITK.xlsx"] [--json]
 *
 * Reads the workbook exactly as the importer would (cell values only — macros are never executed), writes nothing and
 * touches no database. It prints what was understood and what was not: the recognised sheet and header, the mapped
 * project and department columns, row counts, rows that would be skipped and why, unparseable dates, unknown headers,
 * values outside the vocabularies, repeated and missing Projektnummern, identities the file itself cannot decide, and
 * the change summary against an EMPTY database (every row is new). With --itk it also projects which Prüfberichte would
 * link to which of these projects, with the reason for every one that would not.
 *
 * The plan digest at the end is a hash of the planned changes: run twice on an unchanged file, it must not move.
 *
 * Exit code: 0 when the sheet and all required columns were recognised and every department group was found; 1 otherwise
 * (the report says why); 2 for a usage error.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import * as XLSX from "xlsx";
import { importWorkbookSheets } from "../../shared/itk/pruefbericht-import";
import { indexProjects, matchPruefbericht, UNMATCHED_TEXT } from "../../shared/itk/project-link";
import { sheetsFromWorkbook } from "../../shared/itk/workbook";
import { analyzeSource, parseRegisterWorkbook } from "../../shared/register/register-import";
import { planRegister, summarizePlan } from "../../shared/register/register-plan";

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const itkFile = flagValue("--itk");
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--itk");
const asJson = args.includes("--json");
if (!file || !fs.existsSync(file) || (itkFile !== undefined && !fs.existsSync(itkFile))) {
  console.error('usage: pnpm register:inspect "<Übersichtsliste.xlsm>" [--itk "<Projektübersicht ITK.xlsx>"] [--json]');
  process.exit(2);
}

// `bookVBA` stays off: the macro container is neither parsed nor executed.
const workbook = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: false, bookVBA: false });
const { records, report } = parseRegisterWorkbook(sheetsFromWorkbook(XLSX, workbook));
const source = analyzeSource(records);
// the planner turns rows of the file that disagree into explicit questions (ambiguous), so they are planned too
const plan = planRegister(source.forPlanning, []);
const summary = summarizePlan(plan);
const digest = createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);

const state = (name: string) => {
  const h = workbook.Workbook?.Sheets?.find((s) => s.name === name)?.Hidden;
  return h === 2 ? "sehr versteckt" : h === 1 ? "versteckt" : "sichtbar";
};
const sheetNotes = report.ignoredSheets.map((n) => {
  const ws = workbook.Sheets[n];
  return `${n} (${state(n)}, ${ws?.["!ref"] ?? "leer"})`;
});

let link: { unique: number; ambiguous: number; unmatched: Record<string, number>; reports: number } | null = null;
if (itkFile) {
  const itk = importWorkbookSheets(sheetsFromWorkbook(XLSX, XLSX.read(fs.readFileSync(itkFile), { type: "buffer" })));
  const byPn = indexProjects(source.accepted.map((r) => ({ id: r.ref, projektnummer: r.fields.projektnummer, station: r.fields.station, projektstand: r.fields.projektstand })));
  const tally = { unique: 0, ambiguous: 0, unmatched: {} as Record<string, number>, reports: itk.records.length };
  for (const pb of itk.records) {
    const v = matchPruefbericht(pb, byPn);
    if (v.status === "unique") tally.unique += 1;
    else if (v.status === "ambiguous") tally.ambiguous += 1;
    else tally.unmatched[v.reason] = (tally.unmatched[v.reason] ?? 0) + 1;
  }
  link = tally;
}

if (asJson) {
  console.log(JSON.stringify({ report, source: { accepted: source.accepted.length, forPlanning: source.forPlanning.length, heldDuplicates: source.heldDuplicates, identicalDropped: source.identicalDropped }, summary, digest, link, ignoredSheets: sheetNotes }, null, 2));
} else {
  const kinds = new Map<string, number>();
  for (const i of [...report.issues, ...source.issues]) kinds.set(i.kind, (kinds.get(i.kind) ?? 0) + 1);
  console.log(`\nWorkbook: ${file}`);
  console.log(`Blatt: ${report.sheet ?? "— nicht gefunden"}   Kopfzeile: ${report.headerRow ?? "—"}   (erwartet: 8)`);
  console.log(`Projektspalten: ${Object.entries(report.columns).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`Gewerke (${report.departments.length}/14): ${report.departments.map((d) => `${d.department}=${String.fromCharCode(0)}`.replace(String.fromCharCode(0), `${d.header}`)).join(", ")}`);
  if (report.missingDepartments.length) console.log(`  ! nicht gefunden: ${report.missingDepartments.join(", ")}`);
  console.log(`\nZeilen: ${report.rows}   leer: ${report.blank}   Datensätze: ${report.records}   ohne Projektnummer: ${report.withoutProjektnummer}   mehrfach vorkommende Projektnummern: ${report.repeatedProjektnummern}`);
  console.log(`Identität: ${source.accepted.length} eindeutig · ${source.identicalDropped.length} inhaltsgleiche Wiederholung(en) · ${source.heldDuplicates.length} Gruppe(n) mit unterschiedlichem Inhalt unter einer Identität (${source.heldDuplicates.reduce((n, g) => n + g.rows.length, 0)} Zeilen, bis zur Entscheidung nicht importiert)`);
  console.log(`\nÄnderungsübersicht gegen eine leere Datenbank: ${summary.add} neu, ${summary.unchanged} unverändert, ${summary.update} Ergänzungen, ${summary.conflict} Konflikte, ${summary.ambiguous} mehrdeutig (Entscheidung der Administration nötig)`);
  if (report.unknownStatuses.length) {
    console.log("Status außerhalb des Vokabulars (nicht übernommen; Entscheidung der Datenverantwortlichen):");
    for (const u of report.unknownStatuses.sort((a, b) => b.rows - a.rows)) console.log(`  ${u.rows} × „${u.value}“ (${u.department})`);
  }
  console.log(`Planstand (Digest): ${digest}`);
  console.log("\nHinweise nach Art:");
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  const show = (kind: string, max = 8) => {
    const list = [...report.issues, ...source.issues].filter((i) => i.kind === kind && i.severity !== "info");
    for (const i of list.slice(0, max)) console.log(`  - ${i.message}`);
    if (list.length > max) console.log(`  … und ${list.length - max} weitere`);
  };
  for (const kind of ["header-moved", "department-layout", "date-unparseable", "bahnhofsmanagement-unknown", "status-unknown", "value-invalid", "row-no-identity", "duplicate-conflict"]) {
    if (kinds.has(kind)) {
      console.log(`\n[${kind}]`);
      show(kind);
    }
  }
  if (report.unmappedHeaders.length) console.log(`\nKopfzellen ohne Feld: ${report.unmappedHeaders.join("; ")}`);
  console.log(`\nNicht übernommene Blätter (${sheetNotes.length}): ${sheetNotes.join("; ")}`);
  if (link) {
    console.log(`\nVerknüpfung der ${link.reports} Prüfberichte mit diesen Projekten (Projektion, nichts wird geschrieben):`);
    console.log(`  eindeutig: ${link.unique}   mehrdeutig: ${link.ambiguous}   offen: ${Object.values(link.unmatched).reduce((a, b) => a + b, 0)}`);
    for (const [reason, n] of Object.entries(link.unmatched).sort((a, b) => b[1] - a[1])) console.log(`    ${n} × ${UNMATCHED_TEXT[reason as keyof typeof UNMATCHED_TEXT]}`);
  }
}

const clean = report.sheet !== null && !report.issues.some((i) => i.severity === "error") && report.missingDepartments.length === 0;
process.exit(clean ? 0 : 1);
