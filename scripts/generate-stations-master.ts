/**
 * scripts/generate-stations-master.ts
 * ---------------------------------------------------------------------------
 * Deterministic generator for the station master data.
 *
 * INPUTS  (tracked, human-reviewable, TEXT — no binary in git)
 *   data/stations-source.json        REQUIRED. Verbatim RB Mitte extraction of
 *                                    the official DB InfraGO station master
 *                                    (918 rows · 8 columns · NO coordinates).
 *   data/stations-source-national.json
 *                                    OPTIONAL. All 5,426 rows. When present,
 *                                    client/public/stations-national.json is
 *                                    emitted too; when absent it is skipped,
 *                                    because nothing in the app reads it yet.
 *                                    Both are produced by
 *                                    scripts/extract-bahnhoefe-xlsx.ts from the
 *                                    .xlsx — re-run that only when DB publishes
 *                                    a new edition.
 *   data/station-coordinates.json    Coordinate ledger: Bhf-Nr -> {lat,lng}.
 *                                    Bootstrapped once from the previous
 *                                    client/public/stations.json and tracked
 *                                    from then on, so this script stays a pure
 *                                    function of its inputs and is safe to
 *                                    re-run after the master is overwritten.
 *
 * OUTPUTS
 *   client/public/stations.json           RB Mitte projection (the app's master)
 *   client/public/stations-national.json  all 7 Regionalbereiche, for future expansion
 *   data/stations-master.report.json      build report + SHA-256 checksums
 *
 * GUARANTEES
 *   - No coordinate is ever invented. A station with no ledger entry ships
 *     lat: null / lng: null and exactMatch: false, and is excluded from the map
 *     index rather than approximated.
 *   - No station is ever dropped. A station present in the previous master but
 *     absent from the new national file is retained with `retired: true` so that
 *     existing projects referencing it keep resolving; retired rows are hidden
 *     from the create/cascade dropdowns.
 *   - BM values in the RB Mitte projection are canonicalised through
 *     shared/bahnhofsmanagement.ts, so station filters, the project cascade and
 *     the map can never diverge from data.json again.
 *   - Deterministic ordering (Bhf-Nr ascending) and stable key order, so a
 *     re-run with unchanged inputs produces a byte-identical file.
 *
 * Usage:  node --import tsx scripts/generate-stations-master.ts [--check]
 *         --check  verify the committed outputs match a fresh generation
 *                  (exit 1 on drift) without writing anything.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeBahnhofsmanagement,
  STATION_BAHNHOFSMANAGEMENT,
} from "../shared/bahnhofsmanagement";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = path.join(ROOT, "data", "stations-source.json");
const SOURCE_NATIONAL_PATH = path.join(ROOT, "data", "stations-source-national.json");
const LEDGER_PATH = path.join(ROOT, "data", "station-coordinates.json");
const OUT_MITTE = path.join(ROOT, "client", "public", "stations.json");
const OUT_NATIONAL = path.join(ROOT, "client", "public", "stations-national.json");
const REPORT_PATH = path.join(ROOT, "data", "stations-master.report.json");

const TARGET_REGIONALBEREICH = "RB Mitte";
const CHECK_ONLY = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of client/public/stations.json — see client/src/hooks/useStations.ts */
export interface StationMasterRecord {
  "Bf. Nr.": number;
  Station: string;
  BM: string;
  Regionalbereich: string;
  Kategorie: number | null;
  "Straße": string | null;
  PLZ: string | null;
  Ort: string | null;
  Land: string | null;
  DS100: string | null;
  "Aufgabenträger": string | null;
  lat: number | null;
  lng: number | null;
  /** true = coordinates inherited via an exact Bhf-Nr match in the ledger */
  exactMatch: boolean;
  /** present only on rows kept from the previous master but absent from the new one */
  retired?: true;
}

interface RawRow {
  "Bhf. Nr.": number | string | null;
  Bahnhofsname: string | null;
  "Straße": string | null;
  Postleitzahl: string | number | null;
  Ort: string | null;
  Regionalbereich: string | null;
  Bahnhofsmanagement: string | null;
  Kategorie: number | string | null;
}

interface LedgerEntry {
  lat: number;
  lng: number;
  /** provenance — where this coordinate pair came from */
  source: string;
  /** station name at the time the coordinate was recorded, for auditability */
  name: string;
}

type Ledger = Record<string, LedgerEntry>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`\n[generate-stations-master] FATAL: ${message}\n`);
  process.exit(1);
}

/** Collapse whitespace, trim; empty becomes null. Never invents content. */
function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** German PLZ stays a 5-char string so leading zeros survive (01067 Dresden). */
function cleanPlz(v: unknown): string | null {
  const s = clean(v);
  if (s == null) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 0) return null;
  return digits.length < 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
}

function toInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Stable JSON: fixed key order via the literal below, one row per line for reviewable diffs. */
function serialize(rows: StationMasterRecord[]): string {
  const lines = rows.map((r) => JSON.stringify(r));
  return `[\n${lines.join(",\n")}\n]\n`;
}

// ---------------------------------------------------------------------------
// 1. Coordinate ledger — bootstrap once, then read
// ---------------------------------------------------------------------------

function loadOrBootstrapLedger(): Ledger {
  if (fs.existsSync(LEDGER_PATH)) {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as Ledger;
  }

  if (!fs.existsSync(OUT_MITTE)) {
    fail(
      `no coordinate ledger at ${path.relative(ROOT, LEDGER_PATH)} and no previous ${path.relative(ROOT, OUT_MITTE)} to bootstrap it from.`,
    );
  }

  console.log("[1/5] bootstrapping coordinate ledger from previous stations.json …");
  const previous = JSON.parse(fs.readFileSync(OUT_MITTE, "utf8")) as Array<Record<string, unknown>>;
  const ledger: Ledger = {};
  for (const row of previous) {
    const nr = toInt(row["Bf. Nr."]);
    const lat = row.lat;
    const lng = row.lng;
    if (nr == null || typeof lat !== "number" || typeof lng !== "number") continue;
    ledger[String(nr)] = {
      lat,
      lng,
      source: "stations.json@pre-stage-1",
      name: String(row.Station ?? ""),
    };
  }
  if (!CHECK_ONLY) {
    fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  }
  console.log(`      ledger bootstrapped with ${Object.keys(ledger).length} coordinate pairs`);
  return ledger;
}

/** Rows of the previous master, keyed by Bhf-Nr — used to inherit the fields the new Excel drops. */
function loadPreviousByNr(): Map<number, Record<string, unknown>> {
  const map = new Map<number, Record<string, unknown>>();
  if (!fs.existsSync(OUT_MITTE)) return map;
  const previous = JSON.parse(fs.readFileSync(OUT_MITTE, "utf8")) as Array<Record<string, unknown>>;
  for (const row of previous) {
    const nr = toInt(row["Bf. Nr."]);
    if (nr != null) map.set(nr, row);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 2. Parse the national master
// ---------------------------------------------------------------------------

interface SourceFile {
  source: string;
  sourceSha256: string;
  sheet: string;
  scope?: string;
  columns: string[];
  rowCount: number;
  rows: RawRow[];
}

let hasNationalSource = false;
let sourceMeta: Pick<SourceFile, "source" | "sourceSha256" | "rowCount"> | null = null;

function readSourceFile(file: string): { rows: RawRow[]; meta: SourceFile } {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SourceFile;
  const rows = parsed.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`${path.relative(ROOT, file)} has no rows`);
  }
  if (parsed.rowCount !== rows.length) {
    fail(
      `${path.relative(ROOT, file)} is inconsistent: rowCount ${parsed.rowCount} != rows ${rows.length}`,
    );
  }
  const required = [
    "Bhf. Nr.",
    "Bahnhofsname",
    "Straße",
    "Postleitzahl",
    "Ort",
    "Regionalbereich",
    "Bahnhofsmanagement",
    "Kategorie",
  ];
  const present = Object.keys(rows[0] as object);
  const missing = required.filter((c) => !present.includes(c));
  if (missing.length) {
    fail(`${path.relative(ROOT, file)} column layout changed — missing: ${missing.join(", ")}`);
  }
  return { rows, meta: parsed };
}

function readNationalRows(): RawRow[] {
  if (!fs.existsSync(SOURCE_PATH)) {
    fail(
      [
        `missing ${path.relative(ROOT, SOURCE_PATH)}.`,
        "  Regenerate it from the official DB InfraGO workbook:",
        '    cp "Bahnhöfe-2026-06-16 (1).xlsx" data/Bahnhoefe-2026-06-16.xlsx',
        "    node --import tsx scripts/extract-bahnhoefe-xlsx.ts",
      ].join("\n"),
    );
  }

  // The national extract is authoritative when present; otherwise the RB Mitte
  // slice is, and stations-national.json is simply not emitted.
  hasNationalSource = fs.existsSync(SOURCE_NATIONAL_PATH);
  const { rows, meta } = readSourceFile(hasNationalSource ? SOURCE_NATIONAL_PATH : SOURCE_PATH);
  sourceMeta = { source: meta.source, sourceSha256: meta.sourceSha256, rowCount: meta.rowCount };
  return rows;
}

// ---------------------------------------------------------------------------
// 3. Build
// ---------------------------------------------------------------------------

function build() {
  console.log(`[generate-stations-master]${CHECK_ONLY ? " --check" : ""}`);

  const ledger = loadOrBootstrapLedger();
  const previousByNr = loadPreviousByNr();

  console.log("[2/5] reading national station master …");
  const raw = readNationalRows();
  console.log(`      ${raw.length} rows`);

  const warnings: string[] = [];
  const unmappedBm = new Map<string, number>();
  const duplicateNrs: number[] = [];

  const seen = new Set<number>();
  const national: StationMasterRecord[] = [];

  for (const r of raw) {
    const nr = toInt(r["Bhf. Nr."]);
    const name = clean(r.Bahnhofsname);
    if (nr == null || name == null) {
      warnings.push(`skipped row without Bhf-Nr or Bahnhofsname: ${JSON.stringify(r)}`);
      continue;
    }
    if (seen.has(nr)) {
      duplicateNrs.push(nr);
      continue;
    }
    seen.add(nr);

    const regionalbereich = clean(r.Regionalbereich) ?? "unbekannt";
    const isMitte = regionalbereich === TARGET_REGIONALBEREICH;

    // Only the RB Mitte projection is canonicalised — the other six regions keep
    // the official spelling of their own Bahnhofsmanagement (36 further values).
    let bm = clean(r.Bahnhofsmanagement) ?? "";
    if (isMitte) {
      const norm = normalizeBahnhofsmanagement(bm);
      if (norm.value == null) {
        unmappedBm.set(norm.unmapped ?? bm, (unmappedBm.get(norm.unmapped ?? bm) ?? 0) + 1);
      } else {
        bm = norm.value;
      }
    }

    const coord = ledger[String(nr)];
    const prev = previousByNr.get(nr);

    national.push({
      "Bf. Nr.": nr,
      Station: name,
      BM: bm,
      Regionalbereich: regionalbereich,
      Kategorie: toInt(r.Kategorie),
      "Straße": clean(r.Straße),
      PLZ: cleanPlz(r.Postleitzahl),
      Ort: clean(r.Ort),
      // Land / DS100 / Aufgabenträger are absent from the 2026 file — inherited
      // by exact Bhf-Nr from the previous master, never guessed.
      Land: clean(prev?.Land) ?? null,
      DS100: clean(prev?.["Bf DS 100Abk."] ?? prev?.DS100) ?? null,
      "Aufgabenträger": clean(prev?.Aufgabenträger) ?? null,
      lat: coord ? coord.lat : null,
      lng: coord ? coord.lng : null,
      exactMatch: Boolean(coord),
    });
  }

  console.log("[3/5] projecting RB Mitte …");
  const mitte: StationMasterRecord[] = national.filter(
    (s) => s.Regionalbereich === TARGET_REGIONALBEREICH,
  );
  const mitteNrs = new Set(mitte.map((s) => s["Bf. Nr."]));

  // Retain stations that existed in the previous master but are absent from the
  // new national file, so projects referencing them keep resolving on the map.
  const retired: StationMasterRecord[] = [];
  for (const [nr, prev] of previousByNr) {
    if (mitteNrs.has(nr)) continue;
    const coord = ledger[String(nr)];
    const bmNorm = normalizeBahnhofsmanagement(prev.BM);
    retired.push({
      "Bf. Nr.": nr,
      Station: clean(prev.Station) ?? `Bhf ${nr}`,
      BM: bmNorm.value ?? "",
      Regionalbereich: TARGET_REGIONALBEREICH,
      Kategorie: toInt(prev["Kat. Vst"] ?? prev.Kategorie),
      "Straße": clean(prev.Straße),
      PLZ: cleanPlz(prev.PLZ),
      Ort: clean(prev.Ort),
      Land: clean(prev.Land),
      DS100: clean(prev["Bf DS 100Abk."] ?? prev.DS100),
      "Aufgabenträger": clean(prev.Aufgabenträger),
      lat: coord ? coord.lat : null,
      lng: coord ? coord.lng : null,
      exactMatch: Boolean(coord),
      retired: true,
    });
  }

  const mitteAll = [...mitte, ...retired].sort((a, b) => a["Bf. Nr."] - b["Bf. Nr."]);
  national.sort((a, b) => a["Bf. Nr."] - b["Bf. Nr."]);

  // -------------------------------------------------------------------------
  // 4. Invariants — fail loudly rather than ship a broken master
  // -------------------------------------------------------------------------
  console.log("[4/5] verifying invariants …");
  const problems: string[] = [];

  if (unmappedBm.size > 0) {
    for (const [value, count] of unmappedBm) {
      problems.push(`RB Mitte station with un-canonicalisable BM ${JSON.stringify(value)} (${count}×)`);
    }
  }
  if (duplicateNrs.length) {
    problems.push(`duplicate Bhf-Nr in source: ${duplicateNrs.slice(0, 20).join(", ")}`);
  }
  const bmSet = new Set(mitteAll.map((s) => s.BM).filter(Boolean));
  for (const bm of bmSet) {
    if (!(STATION_BAHNHOFSMANAGEMENT as readonly string[]).includes(bm)) {
      problems.push(`non-canonical BM survived into stations.json: ${JSON.stringify(bm)}`);
    }
  }
  for (const s of mitteAll) {
    if ((s.lat == null) !== (s.lng == null)) {
      problems.push(`half-coordinate on Bhf ${s["Bf. Nr."]} (${s.Station})`);
    }
    if (
      s.lat != null &&
      s.lng != null &&
      (s.lat < 45 || s.lat > 56 || s.lng < 5 || s.lng > 16)
    ) {
      problems.push(`coordinate outside Germany on Bhf ${s["Bf. Nr."]}: ${s.lat},${s.lng}`);
    }
  }
  const nameCounts = new Map<string, number>();
  for (const s of mitteAll) nameCounts.set(s.Station, (nameCounts.get(s.Station) ?? 0) + 1);
  const dupNames = [...nameCounts].filter(([, n]) => n > 1).map(([n]) => n);

  if (problems.length) {
    console.error("\n  INVARIANT VIOLATIONS:");
    for (const p of problems) console.error(`   - ${p}`);
    fail(`${problems.length} invariant violation(s) — nothing written.`);
  }

  // -------------------------------------------------------------------------
  // 5. Emit
  // -------------------------------------------------------------------------
  const mitteJson = serialize(mitteAll);
  const nationalJson = serialize(national);

  const withCoords = mitteAll.filter((s) => s.lat != null).length;
  const report = {
    generatedFrom: {
      source: path.relative(ROOT, SOURCE_PATH),
      sourceSha256: createHash("sha256")
        .update(fs.readFileSync(SOURCE_PATH))
        .digest("hex"),
      originalWorkbook: sourceMeta?.source ?? null,
      originalWorkbookSha256: sourceMeta?.sourceSha256 ?? null,
      ledger: path.relative(ROOT, LEDGER_PATH),
      ledgerEntries: Object.keys(ledger).length,
    },
    national: hasNationalSource
      ? { rows: national.length, sha256: sha256(nationalJson) }
      : { skipped: "data/stations-source-national.json not present" },
    rbMitte: {
      rows: mitteAll.length,
      fromNationalMaster: mitte.length,
      retainedRetired: retired.length,
      withCoordinates: withCoords,
      withoutCoordinates: mitteAll.length - withCoords,
      sha256: sha256(mitteJson),
    },
    bahnhofsmanagement: Object.fromEntries(
      [...bmSet].sort().map((bm) => [bm, mitteAll.filter((s) => s.BM === bm).length]),
    ),
    stationsWithoutCoordinates: mitteAll
      .filter((s) => s.lat == null)
      .map((s) => ({ nr: s["Bf. Nr."], station: s.Station, bm: s.BM })),
    retiredStations: retired.map((s) => ({ nr: s["Bf. Nr."], station: s.Station, bm: s.BM })),
    duplicateStationNames: dupNames,
    warnings,
  };

  if (CHECK_ONLY) {
    const drift: string[] = [];
    if (!fs.existsSync(OUT_MITTE) || fs.readFileSync(OUT_MITTE, "utf8") !== mitteJson) {
      drift.push(path.relative(ROOT, OUT_MITTE));
    }
    if (
      hasNationalSource &&
      (!fs.existsSync(OUT_NATIONAL) || fs.readFileSync(OUT_NATIONAL, "utf8") !== nationalJson)
    ) {
      drift.push(path.relative(ROOT, OUT_NATIONAL));
    }
    if (drift.length) fail(`committed output is stale: ${drift.join(", ")}`);
    console.log("[5/5] --check OK — committed outputs match a fresh generation.");
    return;
  }

  fs.writeFileSync(OUT_MITTE, mitteJson, "utf8");
  if (hasNationalSource) fs.writeFileSync(OUT_NATIONAL, nationalJson, "utf8");
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("[5/5] written:");
  console.log(`      ${path.relative(ROOT, OUT_MITTE)}          ${mitteAll.length} rows (${withCoords} with coordinates)`);
  if (hasNationalSource) {
    console.log(`      ${path.relative(ROOT, OUT_NATIONAL)}  ${national.length} rows`);
  } else {
    console.log(
      "      (stations-national.json skipped — data/stations-source-national.json not present;",
    );
    console.log("       nothing in the app reads it yet. Run the extractor to produce it.)");
  }
  console.log(`      ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`\n      BM distribution: ${[...bmSet].sort().map((b) => `${b}=${mitteAll.filter((s) => s.BM === b).length}`).join(" · ")}`);
  if (report.rbMitte.withoutCoordinates > 0) {
    console.log(`\n      ${report.rbMitte.withoutCoordinates} station(s) without coordinates (excluded from the map index, never approximated):`);
    for (const s of report.stationsWithoutCoordinates) console.log(`        ${s.nr}  ${s.station}  [${s.bm}]`);
  }
  if (retired.length) {
    console.log(`\n      ${retired.length} station(s) retained as retired (absent from the 2026 master, still referenced by projects):`);
    for (const s of report.retiredStations) console.log(`        ${s.nr}  ${s.station}  [${s.bm}]`);
  }
}

build();
