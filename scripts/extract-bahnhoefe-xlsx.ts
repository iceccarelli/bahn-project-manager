/**
 * scripts/extract-bahnhoefe-xlsx.ts
 * ---------------------------------------------------------------------------
 * Converts the official DB InfraGO station master workbook into the tracked,
 * text, reviewable source of record that `generate-stations-master.ts` reads:
 *
 *   data/stations-source.json           RB Mitte only (918 rows) — REQUIRED.
 *                                       This is the app's operational scope, so
 *                                       it is small enough to review in a PR.
 *   data/stations-source-national.json  all 5,426 rows — OPTIONAL. Only needed
 *                                       when you want client/public/stations-national.json
 *                                       for expansion beyond RB Mitte.
 *
 * Run this ONLY when DB publishes a new edition of the workbook:
 *
 *   cp "Bahnhöfe-2026-06-16 (1).xlsx" data/Bahnhoefe-2026-06-16.xlsx
 *   node --import tsx scripts/extract-bahnhoefe-xlsx.ts
 *
 * The extraction is verbatim — no normalisation, no filtering, no renaming.
 * Every judgement call lives in generate-stations-master.ts, so the diff of
 * stations-source.json between two editions shows exactly what DB changed.
 *
 * Keeping the derived JSON tracked rather than the .xlsx means the repo has no
 * binary blob, PRs are reviewable, and CI can regenerate without the workbook.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_SCOPED = path.join(DATA_DIR, "stations-source.json");
const OUT_NATIONAL = path.join(DATA_DIR, "stations-source-national.json");
const TARGET_REGIONALBEREICH = "RB Mitte";

const COLUMNS = [
  "Bhf. Nr.",
  "Bahnhofsname",
  "Straße",
  "Postleitzahl",
  "Ort",
  "Regionalbereich",
  "Bahnhofsmanagement",
  "Kategorie",
] as const;

function findWorkbook(): string {
  const explicit = process.argv.find((a) => a.endsWith(".xlsx"));
  if (explicit) return path.resolve(explicit);
  const candidates = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^Bahnhoefe.*\.xlsx$/i.test(f) || /^Bahnhöfe.*\.xlsx$/i.test(f))
    .sort();
  const last = candidates[candidates.length - 1];
  if (!last) {
    console.error(
      [
        "FATAL: no station workbook found in data/.",
        '  Place it there, e.g.  cp "Bahnhöfe-2026-06-16 (1).xlsx" data/Bahnhoefe-2026-06-16.xlsx',
        "  or pass a path:       node --import tsx scripts/extract-bahnhoefe-xlsx.ts /path/to/file.xlsx",
      ].join("\n"),
    );
    process.exit(1);
  }
  return path.join(DATA_DIR, last);
}

function fail(message: string): never {
  console.error(`\n[extract-bahnhoefe-xlsx] FATAL: ${message}\n`);
  process.exit(1);
}

function main() {
  const file = findWorkbook();
  console.log(`[extract-bahnhoefe-xlsx] ${path.relative(ROOT, file)}`);

  const buf = fs.readFileSync(file);
  // XLSX.readFile is unavailable in the ESM build (no fs binding).
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    console.error("FATAL: workbook contains no sheets");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  const first = rows[0];
  if (!first) {
    console.error("FATAL: sheet is empty");
    process.exit(1);
  }
  const missing = COLUMNS.filter((c) => !(c in first));
  if (missing.length) {
    console.error(`FATAL: column layout changed — missing: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Fixed key order + one row per line = a reviewable diff between editions.
  const projected = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of COLUMNS) out[c] = r[c] ?? null;
    return out;
  });

  const sourceSha256 = createHash("sha256").update(buf).digest("hex");

  const write = (out: string, rows: Record<string, unknown>[], scope: string) => {
    const payload = {
      source: path.basename(file),
      sourceSha256,
      sheet: sheetName,
      scope,
      columns: COLUMNS,
      rowCount: rows.length,
    };
    const body = `${JSON.stringify(payload, null, 2).slice(0, -2)},\n  "rows": [\n${rows
      .map((r) => `    ${JSON.stringify(r)}`)
      .join(",\n")}\n  ]\n}\n`;
    fs.writeFileSync(out, body, "utf8");
    console.log(`      ${String(rows.length).padStart(5)} rows -> ${path.relative(ROOT, out)}`);
  };

  const scoped = projected.filter((r) => r.Regionalbereich === TARGET_REGIONALBEREICH);
  if (scoped.length === 0) fail(`no rows with Regionalbereich "${TARGET_REGIONALBEREICH}"`);

  write(OUT_SCOPED, scoped, TARGET_REGIONALBEREICH);
  write(OUT_NATIONAL, projected, "national");
  console.log(`      source sha256 ${sourceSha256}`);
}

main();
