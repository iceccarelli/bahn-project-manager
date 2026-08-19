/**
 * scripts/normalize-existing-data.ts
 * ---------------------------------------------------------------------------
 * Cleans client/public/data.json against the canonical vocabularies, and
 * regenerates the derived blocks so they can never drift from the rows.
 *
 * WHAT IT CHANGES
 *   projects[].bahnhofsmanagement   -> canonical BM (shared/bahnhofsmanagement.ts)
 *                                      or null; never a guess
 *   projects[].station              -> whitespace-collapsed, trimmed
 *   projects[].<text fields>        -> whitespace-collapsed, trimmed,
 *                                      placeholder tokens -> null
 *   projects[].terminProjektvorstellung
 *   reviews[].pruefDatum            -> ISO yyyy-mm-dd. The workbook produced
 *                                      German dd.mm.yyyy for 253 rows, which
 *                                      `new Date()` reads as Invalid Date and a
 *                                      `datetime` column would drop.
 *   stats.regionStats               -> recomputed from the cleaned rows
 *   filters.regions                 -> recomputed from the cleaned rows
 *
 * WHAT IT DELIBERATELY DOES NOT CHANGE
 *   - Station names are never rewritten to match the master. "Fulda Hbf" stays
 *     "Fulda Hbf"; reconciling it to the station "Fulda" is a map-resolution
 *     concern, not a stored-value one. Unresolved names are reported instead.
 *   - projektstand and review status keep their historical free-text values (81
 *     and 14 distinct). Collapsing them to an enum would delete real meaning -
 *     "Plausibilitätsprüfung gBSK", "Niederschrift erstellt (LP05-05-01-F31)".
 *     Grouping happens in code via shared/projektstand.ts and
 *     shared/review-status.ts, so filters and statistics stay clean without the
 *     source being rewritten.
 *   - Values that are not a single usable date are left exactly as they are and
 *     reported: "30.12.20025" (a typo year), "01.02.2023/12.9.23" and three
 *     cells holding two dates. Guessing which one is meant is a business
 *     decision, not a script's.
 *
 * OUTPUTS
 *   client/public/data.json               rewritten in place (same key order)
 *   data/normalize-report.json            every changed cell, before -> after
 *
 * Usage:  node --import tsx scripts/normalize-existing-data.ts [--dry-run] [--fill-bahnhofsnummer]
 *           --dry-run              report only, write nothing
 *           --fill-bahnhofsnummer  additionally fill a null bahnhofsnummer when
 *                                  the station name matches exactly ONE station
 *                                  in the project's own BM (off by default -
 *                                  it is a join, but it widens the diff)
 *
 * LOCALSTORAGE MIGRATION
 *   The live SPA caches this file under the localStorage key defined by
 *   STORAGE_KEY_PROJECTS in client/src/_core/api/client.ts. That key carries a
 *   schema version; bump it whenever this script changes stored values, so every
 *   browser discards its stale copy and re-seeds. No user action needed.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBahnhofsmanagement } from "../shared/bahnhofsmanagement";
import { parseStoredDate } from "../shared/date";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = path.join(ROOT, "client", "public", "data.json");
const STATIONS_PATH = path.join(ROOT, "client", "public", "stations.json");
const REPORT_PATH = path.join(ROOT, "data", "normalize-report.json");

const DRY_RUN = process.argv.includes("--dry-run");
const FILL_BFNR = process.argv.includes("--fill-bahnhofsnummer");

/** Same token set as client/src/_core/api/client.ts - kept in lockstep. */
const PLACEHOLDER_TOKENS = new Set(["", "???", "n/a", "na", "null", "bitte auswählen"]);

const TEXT_FIELDS = [
  "projektnummer",
  "station",
  "bahnhofsnummer",
  "streckennummer",
  "projektbeschreibung",
  "projektstand",
  "projektleiter",
  "kommentar",
  "projektLink",
] as const;

interface Review {
  department: string;
  prueferName: string | null;
  pruefDatum: string | null;
  status: string | null;
  [k: string]: unknown;
}
interface Project {
  id: number;
  bahnhofsmanagement: string | null;
  station: string | null;
  bahnhofsnummer: string | null;
  projektstand: string | null;
  terminProjektvorstellung: string | null;
  reviews: Review[];
  [k: string]: unknown;
}
interface DataFile {
  projects: Project[];
  stats: Record<string, unknown>;
  filters: Record<string, unknown>;
}
interface StationRow {
  "Bf. Nr.": number;
  Station: string;
  BM: string;
  retired?: true;
}

interface Change {
  id: number;
  field: string;
  from: unknown;
  to: unknown;
}

function cleanStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return PLACEHOLDER_TOKENS.has(s.toLowerCase()) ? null : s;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function main() {
  console.log(
    `[normalize-existing-data]${DRY_RUN ? " --dry-run" : ""}${FILL_BFNR ? " --fill-bahnhofsnummer" : ""}`,
  );

  if (!fs.existsSync(DATA_PATH)) {
    console.error(`FATAL: ${path.relative(ROOT, DATA_PATH)} not found`);
    process.exit(1);
  }
  const before = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(before) as DataFile;
  const projects = data.projects;
  console.log(`[1/4] loaded ${projects.length} projects (sha256 ${sha256(before).slice(0, 12)})`);

  // Station index for the optional bahnhofsnummer join and the unresolved report.
  const stationRows: StationRow[] = fs.existsSync(STATIONS_PATH)
    ? (JSON.parse(fs.readFileSync(STATIONS_PATH, "utf8")) as StationRow[])
    : [];
  const byBmAndName = new Map<string, StationRow[]>();
  for (const s of stationRows) {
    const key = `${s.BM}\u241f${s.Station}`;
    const bucket = byBmAndName.get(key);
    if (bucket) bucket.push(s);
    else byBmAndName.set(key, [s]);
  }
  const allStationNames = new Set(stationRows.map((s) => s.Station));

  const changes: Change[] = [];
  const unmappedBm = new Map<string, number>();
  const dateReasons = new Map<string, number>();
  const unparseableDates: Array<{ id: number; value: string }> = [];
  let bfNrFilled = 0;

  console.log("[2/4] normalising");
  for (const p of projects) {
    // --- bahnhofsmanagement: canonical or null ---------------------------
    const bm = normalizeBahnhofsmanagement(p.bahnhofsmanagement);
    if (bm.unmapped) unmappedBm.set(bm.unmapped, (unmappedBm.get(bm.unmapped) ?? 0) + 1);
    if (p.bahnhofsmanagement !== bm.value) {
      changes.push({
        id: p.id,
        field: "bahnhofsmanagement",
        from: p.bahnhofsmanagement,
        to: bm.value,
      });
      p.bahnhofsmanagement = bm.value;
    }

    // --- text fields: collapse + trim + placeholder -> null ---------------
    for (const f of TEXT_FIELDS) {
      const next = cleanStr(p[f]);
      if (p[f] !== next) {
        changes.push({ id: p.id, field: f, from: p[f], to: next });
        p[f] = next;
      }
    }

    // --- dates: German dd.mm.yyyy -> ISO ---------------------------------
    {
      const parsed = parseStoredDate(p.terminProjektvorstellung);
      dateReasons.set(parsed.reason, (dateReasons.get(parsed.reason) ?? 0) + 1);
      // Only rewrite when we produced a date, or when the value was a pure
      // placeholder. Anything unparseable keeps its original text.
      const next =
        parsed.iso ?? (parsed.reason === "placeholder" || parsed.reason === "empty" ? null : undefined);
      if (next !== undefined && p.terminProjektvorstellung !== next) {
        changes.push({
          id: p.id,
          field: "terminProjektvorstellung",
          from: p.terminProjektvorstellung,
          to: next,
        });
        p.terminProjektvorstellung = next;
      }
      if (parsed.reason === "ambiguous" || parsed.reason === "unrecognised") {
        unparseableDates.push({ id: p.id, value: String(p.terminProjektvorstellung) });
      }
    }

    // --- reviews ----------------------------------------------------------
    if (Array.isArray(p.reviews)) {
      for (const r of p.reviews) {
        const parsedDatum = parseStoredDate(r.pruefDatum);
        const nextDatum =
          parsedDatum.iso ??
          (parsedDatum.reason === "placeholder" || parsedDatum.reason === "empty" ? null : undefined);
        if (nextDatum !== undefined && r.pruefDatum !== nextDatum) {
          changes.push({
            id: p.id,
            field: `reviews.${r.department}.pruefDatum`,
            from: r.pruefDatum,
            to: nextDatum,
          });
          r.pruefDatum = nextDatum;
        }
        for (const f of ["prueferName", "status"] as const) {
          const next = cleanStr(r[f]);
          if (r[f] !== next) {
            changes.push({
              id: p.id,
              field: `reviews.${r.department}.${f}`,
              from: r[f],
              to: next,
            });
            r[f] = next;
          }
        }
      }
    }

    // --- optional: bahnhofsnummer join ------------------------------------
    if (FILL_BFNR && !p.bahnhofsnummer && p.bahnhofsmanagement && p.station) {
      const hits = byBmAndName.get(`${p.bahnhofsmanagement}\u241f${p.station}`) ?? [];
      const only = hits.length === 1 ? hits[0] : undefined;
      if (only) {
        const nr = String(only["Bf. Nr."]);
        changes.push({ id: p.id, field: "bahnhofsnummer", from: null, to: nr });
        p.bahnhofsnummer = nr;
        bfNrFilled++;
      }
    }
  }

  // --- derived blocks: recompute so they cannot drift from the rows -------
  console.log("[3/4] recomputing derived blocks");
  const regionCounts = new Map<string, number>();
  for (const p of projects) {
    if (p.bahnhofsmanagement) {
      regionCounts.set(p.bahnhofsmanagement, (regionCounts.get(p.bahnhofsmanagement) ?? 0) + 1);
    }
  }
  const collator = new Intl.Collator("de");
  data.stats.regionStats = [...regionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .map(([region, count]) => ({ region, count }));
  data.filters.regions = [...regionCounts.keys()].sort(collator.compare);

  // --- diagnostics that Stage 2 / Stage 5 will act on ---------------------
  const unresolvedStations = new Map<string, number>();
  for (const p of projects) {
    if (p.station && !allStationNames.has(p.station)) {
      unresolvedStations.set(p.station, (unresolvedStations.get(p.station) ?? 0) + 1);
    }
  }
  const nonIsoTermine = projects
    .filter(
      (p) =>
        p.terminProjektvorstellung &&
        !/^\d{4}-\d{2}-\d{2}/.test(String(p.terminProjektvorstellung)),
    )
    .map((p) => ({ id: p.id, value: p.terminProjektvorstellung }));

  const after = `${JSON.stringify(data, null, 2)}\n`;

  const byField = new Map<string, number>();
  for (const c of changes) {
    const key = c.field.startsWith("reviews.")
      ? `reviews.*.${c.field.split(".").pop()}`
      : c.field;
    byField.set(key, (byField.get(key) ?? 0) + 1);
  }

  // Number -> string coercions are called out separately: they look like a large
  // diff but they are a type correction, not a value change. bahnhofsnummer,
  // streckennummer and projektnummer are declared `string | null` in every
  // layer that touches them - client/src/hooks/useDataQuery.ts Project,
  // shared/validation.ts ProjectSchema, drizzle/schema.ts varchar(32) - while
  // data.json stored some of them as JSON numbers. That mismatch is what commit
  // 7c42b6d had to work around by coercing inside the search filter.
  const typeCoercions = changes.filter(
    (c) => typeof c.from === "number" && typeof c.to === "string" && String(c.from) === c.to,
  );
  const coercionByField = new Map<string, number>();
  for (const c of typeCoercions) {
    coercionByField.set(c.field, (coercionByField.get(c.field) ?? 0) + 1);
  }

  const report = {
    input: {
      file: "client/public/data.json",
      sha256Before: sha256(before),
      projects: projects.length,
    },
    output: { sha256After: sha256(after), dryRun: DRY_RUN },
    summary: {
      totalCellsChanged: changes.length,
      byField: Object.fromEntries([...byField].sort((a, b) => b[1] - a[1])),
      bahnhofsnummerFilled: bfNrFilled,
      numberToStringCoercions: {
        note: "type corrections, not value changes - the declared type in useDataQuery.ts, shared/validation.ts and drizzle/schema.ts is `string | null`",
        total: typeCoercions.length,
        byField: Object.fromEntries([...coercionByField].sort((a, b) => b[1] - a[1])),
      },
      realValueChanges: changes.length - typeCoercions.length,
    },
    bahnhofsmanagement: {
      canonicalDistribution: Object.fromEntries(
        [...regionCounts.entries()].sort((a, b) => b[1] - a[1]),
      ),
      projectsWithoutBm: projects.filter((p) => !p.bahnhofsmanagement).length,
      unmapped: Object.fromEntries([...unmappedBm].sort((a, b) => b[1] - a[1])),
    },
    dates: {
      parsedAs: Object.fromEntries([...dateReasons].sort((a, b) => b[1] - a[1])),
      leftAsIs: {
        note: "not a single usable date - deciding which date is meant is a business call",
        count: unparseableDates.length,
        values: unparseableDates,
      },
      remainingNonIso: {
        count: nonIsoTermine.length,
        samples: nonIsoTermine.slice(0, 20),
      },
    },
    deferred: {
      note: "reported, deliberately not changed",
      distinctProjektstand: [...new Set(projects.map((p) => p.projektstand).filter(Boolean))]
        .length,
      distinctReviewStatus: [
        ...new Set(
          projects
            .flatMap((p) => p.reviews ?? [])
            .map((r) => r.status)
            .filter(Boolean),
        ),
      ].sort(),
    },
    stationNamesNotInMaster: {
      note: "not rewritten - input for the Stage 5 map-resolution pass",
      distinct: unresolvedStations.size,
      projectsAffected: [...unresolvedStations.values()].reduce((a, b) => a + b, 0),
      top: Object.fromEntries(
        [...unresolvedStations].sort((a, b) => b[1] - a[1]).slice(0, 40),
      ),
    },
    changes,
  };

  if (!DRY_RUN) {
    fs.writeFileSync(DATA_PATH, after, "utf8");
  }

  // The script is idempotent, so a second run legitimately changes nothing - but
  // it must not then overwrite the audit trail of the run that DID change 1,301
  // cells. Keep the last report that has content.
  const reportExists = fs.existsSync(REPORT_PATH);
  const wouldClobber = reportExists && changes.length === 0;
  if (!wouldClobber) {
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log("[4/4] done.");
  console.log(`      cells changed : ${changes.length} (${typeCoercions.length} number->string type corrections, ${changes.length - typeCoercions.length} real value changes)`);
  for (const [f, n] of [...byField].sort((a, b) => b[1] - a[1])) {
    console.log(`        ${f.padEnd(28)} ${n}`);
  }
  console.log(
    `      BM distribution: ${[...regionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `${r}=${c}`)
      .join(" | ")}`,
  );
  console.log(`      projects without BM: ${report.bahnhofsmanagement.projectsWithoutBm}`);
  if (unmappedBm.size) {
    console.log("      UNMAPPED BM VALUES (left as null - review these):");
    for (const [v, n] of unmappedBm) console.log(`        ${JSON.stringify(v)} x${n}`);
  }
  console.log(
    `      station names not in master: ${unresolvedStations.size} distinct / ${report.stationNamesNotInMaster.projectsAffected} projects`,
  );
  console.log(
    `      dates: ${[...dateReasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" | ")}`,
  );
  console.log(`      dates left as-is (not a single usable date): ${unparseableDates.length}`);
  if (wouldClobber) {
    console.log(
      `      nothing to change - kept the existing ${path.relative(ROOT, REPORT_PATH)} (audit trail of the last run that did).`,
    );
  } else {
    console.log(`      report: ${path.relative(ROOT, REPORT_PATH)}`);
  }
  if (DRY_RUN) console.log("      --dry-run: data.json was NOT modified.");
}

main();
