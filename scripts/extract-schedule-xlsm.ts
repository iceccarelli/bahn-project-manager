/**
 * scripts/extract-schedule-xlsm.ts
 * ---------------------------------------------------------------------------
 * Extracts the Fachspezialistenprüfung slot calendar from sheet
 * `Zeit auswählen` of the Projektanmeldung workbook into
 * `client/public/schedule.json` — the file the wizard's slot picker reads.
 *
 * The calendar is a fixed grid: every slot is a Tuesday, five per day
 * (09:00, 10:00, 11:00, 13:00, 14:00), each 50 minutes. 647 rows spanning
 * 2024-06-04 to 2026-12-22.
 *
 * Column meanings (sheet row 3 is the header):
 *   A Datum      B Von      C Bis      D Frei/Gebucht      E weitere Informationen
 *   F  a free-text constraint note, e.g. "TBQ nicht verfügbar"
 *
 * Column E on a booked slot follows the pattern the VBA writes:
 *   Sheets("Zeit auswählen").Range("E" & row) = G6 & " - " & D8 & " - " & D9
 * i.e. "<Projektleitung> - <Station> - <Projektstand>". It is parsed on a
 * best-effort basis and the raw string is always preserved.
 *
 * Usage:  node --import tsx scripts/extract-schedule-xlsm.ts [path/to/workbook.xlsm]
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { TERMIN_STATUS } from "../shared/checklist";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT = path.join(ROOT, "client", "public", "schedule.json");
const REPORT = path.join(DATA_DIR, "schedule.report.json");
const SHEET = "Zeit auswählen";

interface Slot {
  /** stable id: "<ISO date>T<HH:MM>" — unique, and sortable */
  id: string;
  datum: string;
  von: string;
  bis: string;
  status: string;
  /** raw column E */
  info: string | null;
  /** parsed from info where the "PL - Station - Stand" pattern holds */
  projektleitung: string | null;
  station: string | null;
  projektstand: string | null;
  /** column F — which specialists are unavailable that slot */
  hinweis: string | null;
}

function fail(message: string): never {
  console.error(`\n[extract-schedule-xlsm] FATAL: ${message}\n`);
  process.exit(1);
}

function findWorkbook(): string {
  const explicit = process.argv.find((a) => a.endsWith(".xlsm") || a.endsWith(".xlsx"));
  if (explicit) return path.resolve(explicit);
  const candidates = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsm"))
    .sort();
  const last = candidates[candidates.length - 1];
  if (!last) {
    fail(
      [
        "no .xlsm workbook found in data/.",
        '  Place it there, e.g.  cp "Projektanmeldung Fachspezialistenprüfung_neu.xlsm" \\',
        "                          data/Projektanmeldung-Fachspezialistenpruefung.xlsm",
      ].join("\n"),
    );
  }
  return path.join(DATA_DIR, last);
}

/** Excel serial day -> ISO date. Excel's epoch is 1899-12-30 (the 1900 leap-year bug). */
function serialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) return serialToIso(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  return null;
}

/** Excel times arrive as a fraction of a day, a Date, or "HH:MM:SS". */
function toTime(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === "number" && Number.isFinite(v)) {
    const minutes = Math.round(v * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
    if (m) return `${m[1]?.padStart(2, "0")}:${m[2]}`;
  }
  return null;
}

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** "Katja Behn - Hanau Hbf - Mieterumbau MaG" -> its three parts. */
function parseInfo(info: string | null) {
  if (!info) return { projektleitung: null, station: null, projektstand: null };
  const parts = info.split(" - ").map((p) => p.trim());
  if (parts.length < 3) return { projektleitung: null, station: null, projektstand: null };
  return {
    projektleitung: parts[0] || null,
    station: parts.slice(1, -1).join(" - ") || null,
    projektstand: parts[parts.length - 1] || null,
  };
}

function main() {
  const file = findWorkbook();
  console.log(`[extract-schedule-xlsm] ${path.relative(ROOT, file)}`);

  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[SHEET];
  if (!sheet) fail(`workbook has no sheet "${SHEET}" (found: ${wb.SheetNames.join(", ")})`);

  // header is on row 3, so data starts on row 4
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: 3,
    defval: null,
    raw: true,
  });

  const slots: Slot[] = [];
  const skipped: Array<{ row: number; reason: string; raw: unknown[] }> = [];
  const seen = new Set<string>();
  const statusCounts = new Map<string, number>();
  const unknownStatus = new Set<string>();

  rows.forEach((r, i) => {
    const excelRow = i + 4;
    const datum = toIsoDate(r[0]);
    const von = toTime(r[1]);
    const bis = toTime(r[2]);
    const status = clean(r[3]);

    if (!datum || !von || !bis || !status) {
      if (r.some((c) => c != null)) skipped.push({ row: excelRow, reason: "incomplete", raw: r });
      return;
    }
    if (!(TERMIN_STATUS as readonly string[]).includes(status)) unknownStatus.add(status);

    const id = `${datum}T${von}`;
    if (seen.has(id)) {
      skipped.push({ row: excelRow, reason: `duplicate slot ${id}`, raw: r });
      return;
    }
    seen.add(id);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const info = clean(r[4]);
    slots.push({
      id,
      datum,
      von,
      bis,
      status,
      info,
      ...parseInfo(info),
      hinweis: clean(r[5]),
    });
  });

  if (slots.length === 0) fail("no slots parsed");
  slots.sort((a, b) => a.id.localeCompare(b.id));

  // --- invariants ---------------------------------------------------------
  const problems: string[] = [];
  if (unknownStatus.size) {
    problems.push(
      `status values outside Hilfsdatei!N34:N37: ${[...unknownStatus].map((s) => JSON.stringify(s)).join(", ")}`,
    );
  }
  const weekdays = new Set(slots.map((s) => new Date(`${s.datum}T00:00:00Z`).getUTCDay()));
  if (weekdays.size !== 1 || !weekdays.has(2)) {
    problems.push(`expected every slot on a Tuesday, found weekdays ${[...weekdays].join(", ")}`);
  }
  if (problems.length) {
    console.error("\n  INVARIANT VIOLATIONS:");
    for (const p of problems) console.error(`   - ${p}`);
    fail(`${problems.length} invariant violation(s) — nothing written.`);
  }

  const body = `[\n${slots.map((s) => JSON.stringify(s)).join(",\n")}\n]\n`;
  fs.writeFileSync(OUT, body, "utf8");

  const times = [...new Set(slots.map((s) => `${s.von}-${s.bis}`))].sort();
  const report = {
    generatedFrom: {
      workbook: path.basename(file),
      sha256: createHash("sha256").update(buf).digest("hex"),
      sheet: SHEET,
    },
    slots: slots.length,
    sha256: createHash("sha256").update(body, "utf8").digest("hex"),
    range: { from: slots[0]?.datum, to: slots[slots.length - 1]?.datum },
    slotTimes: times,
    status: Object.fromEntries([...statusCounts].sort((a, b) => b[1] - a[1])),
    hinweise: Object.fromEntries(
      [...slots.reduce((m, s) => {
        if (s.hinweis) m.set(s.hinweis, (m.get(s.hinweis) ?? 0) + 1);
        return m;
      }, new Map<string, number>())].sort((a, b) => b[1] - a[1]),
    ),
    skipped,
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`      ${slots.length} slots -> ${path.relative(ROOT, OUT)}`);
  console.log(`      range ${report.range.from} .. ${report.range.to}`);
  console.log(`      times ${times.join(" | ")}`);
  console.log(`      status ${[...statusCounts].map(([k, v]) => `${k}=${v}`).join(" | ")}`);
  if (skipped.length) console.log(`      skipped ${skipped.length} row(s) — see ${path.relative(ROOT, REPORT)}`);
}

main();
