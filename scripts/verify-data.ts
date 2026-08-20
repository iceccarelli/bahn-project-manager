/**
 * scripts/verify-data.ts
 * ---------------------------------------------------------------------------
 * Operator-facing integrity report for the station master and the project
 * dataset. Runs on the committed artifacts only - no source workbook, no
 * database - so it is safe in CI on every push.
 *
 * The vitest suite in shared/*.test.ts is the primary gate and asserts the same
 * invariants in more detail; this script exists because a failing CI step that
 * prints the actual numbers is faster to act on than a test diff.
 *
 * It fails the build when any of these stop holding:
 *   S1  stations.json parses, is non-empty, and every Bf. Nr. is unique
 *   S2  every BM in stations.json is one of the canonical values
 *   S3  no half-coordinates, and every coordinate lies inside Germany
 *   S4  (BM, Station) is unique - the cascade can never be ambiguous
 *   D1  every bahnhofsmanagement in data.json is canonical or null
 *   D2  filters.regions and stats.regionStats agree with the rows they describe
 *   D3  the project/review row counts are unchanged (1298 / 18172)
 *   G1  map resolution does not regress past the committed baseline
 *
 * Usage:  node --import tsx scripts/verify-data.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStationGeo, resolveAll } from "../client/src/lib/stationGeo";
import type { StationRecord } from "../client/src/hooks/useStations";
import { BAHNHOFSMANAGEMENT, STATION_BAHNHOFSMANAGEMENT } from "../shared/bahnhofsmanagement";
import { CHECKLIST_QUESTIONS, DEPARTMENT_QUESTIONS } from "../shared/checklist";
import { parseStoredDate } from "../shared/date";
import { normalizeProjektstand } from "../shared/projektstand";
import { normalizeReviewStatus } from "../shared/review-status";
import {
  CONTACTS,
  DEPARTMENT_RECIPIENT_ROWS,
  departmentsWithoutRecipients,
} from "../shared/contacts";
import { DEPARTMENTS } from "../shared/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIONS = path.join(ROOT, "client", "public", "stations.json");
const DATA = path.join(ROOT, "client", "public", "data.json");

/**
 * Committed baseline. Tighten these as the data improves; never loosen them
 * without saying why in the commit message.
 */
const BASELINE = {
  projects: 1298,
  reviews: 18172,
  /** projects that resolve to a real station (exact + tokens + fuzzy) */
  minPlacedOnStation: 1170,
  /** projects placed only on a region centroid */
  maxRegionOnly: 100,
  /** projects that cannot be placed at all - no station match and no BM */
  maxUnresolved: 30,
};

const failures: string[] = [];
const notes: string[] = [];

function check(id: string, ok: boolean, message: string) {
  if (!ok) failures.push(`${id}  ${message}`);
}

function main() {
  console.log("[verify-data]");

  // ---------------------------------------------------------------- stations
  const stations = JSON.parse(fs.readFileSync(STATIONS, "utf8")) as StationRecord[];
  check("S1", Array.isArray(stations) && stations.length > 0, "stations.json is empty or not an array");

  const nrs = new Set<number>();
  const dupNr: number[] = [];
  const cascadeKeys = new Set<string>();
  const dupCascade: string[] = [];
  const badBm = new Set<string>();
  const badCoord: string[] = [];
  let withCoords = 0;

  for (const s of stations) {
    if (nrs.has(s["Bf. Nr."])) dupNr.push(s["Bf. Nr."]);
    nrs.add(s["Bf. Nr."]);

    if (!(STATION_BAHNHOFSMANAGEMENT as readonly string[]).includes(s.BM)) badBm.add(s.BM);

    if ((s.lat == null) !== (s.lng == null)) {
      badCoord.push(`${s["Bf. Nr."]} ${s.Station}: half-coordinate`);
    } else if (s.lat != null && s.lng != null) {
      withCoords++;
      if (s.lat < 45 || s.lat > 56 || s.lng < 5 || s.lng > 16) {
        badCoord.push(`${s["Bf. Nr."]} ${s.Station}: ${s.lat},${s.lng} outside Germany`);
      }
    }

    if (!s.retired) {
      const key = `${s.BM}␟${s.Station}`;
      if (cascadeKeys.has(key)) dupCascade.push(key);
      cascadeKeys.add(key);
    }
  }

  check("S1", dupNr.length === 0, `duplicate Bf. Nr.: ${dupNr.slice(0, 10).join(", ")}`);
  check("S2", badBm.size === 0, `non-canonical BM in stations.json: ${[...badBm].join(", ")}`);
  check("S3", badCoord.length === 0, `bad coordinates:\n      ${badCoord.slice(0, 10).join("\n      ")}`);
  check("S4", dupCascade.length === 0, `duplicate (BM, Station): ${dupCascade.slice(0, 10).join(", ")}`);

  const retired = stations.filter((s) => s.retired).length;
  notes.push(
    `stations: ${stations.length} rows (${withCoords} with coordinates, ` +
      `${stations.length - withCoords} without, ${retired} retired)`,
  );

  // -------------------------------------------------------------------- data
  const data = JSON.parse(fs.readFileSync(DATA, "utf8")) as {
    projects: Array<{
      bahnhofsmanagement: string | null;
      station: string | null;
      projektstand: string | null;
      terminProjektvorstellung: string | null;
      reviews: unknown[];
    }>;
    stats: { regionStats: Array<{ region: string; count: number }> };
    filters: { regions: string[] };
  };

  const reviewCount = data.projects.reduce((n, p) => n + (p.reviews?.length ?? 0), 0);
  check("D3", data.projects.length === BASELINE.projects, `project count ${data.projects.length} != ${BASELINE.projects}`);
  check("D3", reviewCount === BASELINE.reviews, `review count ${reviewCount} != ${BASELINE.reviews}`);

  const badProjectBm = new Map<string, number>();
  const actualRegions = new Map<string, number>();
  for (const p of data.projects) {
    const bm = p.bahnhofsmanagement;
    if (bm == null) continue;
    if (!(BAHNHOFSMANAGEMENT as readonly string[]).includes(bm)) {
      badProjectBm.set(bm, (badProjectBm.get(bm) ?? 0) + 1);
    }
    actualRegions.set(bm, (actualRegions.get(bm) ?? 0) + 1);
  }
  check(
    "D1",
    badProjectBm.size === 0,
    `non-canonical bahnhofsmanagement in data.json: ${[...badProjectBm]
      .map(([v, n]) => `${JSON.stringify(v)} x${n}`)
      .join(", ")}`,
  );

  const declaredRegions = [...data.filters.regions].sort();
  const derivedRegions = [...actualRegions.keys()].sort();
  check(
    "D2",
    JSON.stringify(declaredRegions) === JSON.stringify(derivedRegions),
    `filters.regions drifted from the rows\n      declared: ${declaredRegions.join(", ")}\n      derived : ${derivedRegions.join(", ")}`,
  );

  const declaredStats = [...data.stats.regionStats]
    .map((r) => `${r.region}=${r.count}`)
    .sort()
    .join(" ");
  const derivedStats = [...actualRegions]
    .map(([r, c]) => `${r}=${c}`)
    .sort()
    .join(" ");
  check("D2", declaredStats === derivedStats, `stats.regionStats drifted from the rows\n      declared: ${declaredStats}\n      derived : ${derivedStats}`);

  // -------------------------------------------------------------- vocabularies
  const psCanonical = data.projects.filter((p) => normalizeProjektstand(p.projektstand).canonical).length;
  const psUnmapped = new Map<string, number>();
  for (const p of data.projects) {
    const u = normalizeProjektstand(p.projektstand).unmapped;
    if (u) psUnmapped.set(u, (psUnmapped.get(u) ?? 0) + 1);
  }
  const badStatus = new Set<string>();
  for (const p of data.projects) {
    for (const r of p.reviews as Array<{ status?: string | null }>) {
      if (r.status && normalizeReviewStatus(r.status) === null) badStatus.add(r.status);
    }
  }
  check("V1", badStatus.size === 0, `review statuses outside the canonical vocabulary: ${[...badStatus].join(", ")}`);
  notes.push(
    `projektstand: ${psCanonical} canonical | ${[...psUnmapped.values()].reduce((a, b) => a + b, 0)} free-text (${psUnmapped.size} distinct)`,
  );

  // -------------------------------------------------------------------- dates
  const dateReasons = new Map<string, number>();
  for (const p of data.projects) {
    const r = parseStoredDate(p.terminProjektvorstellung as string | null);
    dateReasons.set(r.reason, (dateReasons.get(r.reason) ?? 0) + 1);
  }
  check("V2", (dateReasons.get("german") ?? 0) === 0, `${dateReasons.get("german")} terminProjektvorstellung values are still German dd.mm.yyyy`);
  check("V3", (dateReasons.get("invalid-date") ?? 0) === 0, `${dateReasons.get("invalid-date")} impossible calendar dates`);
  notes.push(`dates: ${[...dateReasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" | ")}`);

  // ---------------------------------------------------------------- checklist
  const deptQ = DEPARTMENT_QUESTIONS.map((q) => q.department);
  check("C1", CHECKLIST_QUESTIONS.length === 22, `checklist has ${CHECKLIST_QUESTIONS.length} questions, expected 22`);
  check("C2", new Set(deptQ).size === 14, `checklist maps to ${new Set(deptQ).size} departments, expected 14`);
  notes.push(`checklist: ${CHECKLIST_QUESTIONS.length} questions | ${deptQ.length} department mappings`);

  // --------------------------------------------------------------------- geo
  const index = buildStationGeo(stations);
  const { stats } = resolveAll(index, data.projects);
  const placedOnStation = stats.exact + stats.tokens + stats.fuzzy;

  notes.push(
    `resolution: ${stats.exact} exact | ${stats.tokens} tokens | ${stats.fuzzy} fuzzy | ` +
      `${stats.region} region-only | ${stats.unresolved} unresolved`,
  );

  check("G1", placedOnStation >= BASELINE.minPlacedOnStation, `only ${placedOnStation} projects placed on a real station (baseline >= ${BASELINE.minPlacedOnStation})`);
  check("G1", stats.region <= BASELINE.maxRegionOnly, `${stats.region} projects placed on a region centroid (baseline <= ${BASELINE.maxRegionOnly})`);
  check("G1", stats.unresolved <= BASELINE.maxUnresolved, `${stats.unresolved} projects cannot be placed (baseline <= ${BASELINE.maxUnresolved})`);

  // ------------------------------------------------------------------ report
  for (const n of notes) console.log(`      ${n}`);
  if (failures.length) {
    console.error(`\n  ${failures.length} CHECK(S) FAILED:`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  // ---- contacts ---------------------------------------------------------
  // The Excel macro reported a successful send even when the recipient rows
  // held no address, so a department could go years without anyone being
  // told. Surfacing it here makes it a standing gate rather than a
  // discovery.
  {
    const unreachable = departmentsWithoutRecipients();
    const reachable = DEPARTMENTS.length - unreachable.length;
    console.log(
      `      contacts: ${CONTACTS.length} Adressen | ${reachable}/${DEPARTMENTS.length} Gewerke erreichbar${
        unreachable.length ? ` | ohne Adresse: ${unreachable.join(", ")}` : ""
      }`,
    );
    const itk = DEPARTMENT_RECIPIENT_ROWS.ITK;
    if (itk[0] !== 10) {
      throw new Error(
        `ITK recipients start at Hilfsdatei row ${itk[0]}, expected 10 — the off-by-two has come back`,
      );
    }
  }

  console.log("      all checks passed.");
}

main();
