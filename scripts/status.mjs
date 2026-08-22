#!/usr/bin/env node
/**
 * Where am I?
 *
 * The gates print several hundred lines and answer one question each. This
 * answers the only question that matters between patches — is the work I think
 * I applied actually in this tree, and is the thing my browser shows me built
 * from it — in one screen, in under a second, without a browser.
 *
 * It reads the source for markers rather than trusting a commit message: a
 * commit can be reverted, a patch can half-apply, a file can be hand-edited.
 * A marker is present or it is not.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ESC = String.fromCharCode(27);
const paint = (code) => (s) => `${ESC}[${code}m${s}${ESC}[0m`;
const green = paint(32);
const red = paint(31);
const dim = paint(2);
const bold = paint(1);

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/**
 * Each feature, and a string that exists only when that feature is present.
 * Oldest first, so a half-applied history reads top to bottom.
 */
const FEATURES = [
  ["Gewerk-Workspaces (BVB-EEA / PSV-ITK)", "client/src/components/workspace/ReviewWorkspace.tsx", "ReviewWorkspaceProps"],
  ["Geteilte Tabellenteile", "client/src/components/workspace/table-parts.tsx", "export function SortHeader"],
  ["Suche uber die ganze Seite", "shared/search-index.ts", "export function buildSearchIndex"],
  ["Status als Dropdown, uberall", "client/src/components/workspace/table-parts.tsx", "export function StatusSelect"],
  ["Anderungshistorie mit Schwere und Ruckgangig", "shared/audit-entry.ts", "export function markCorrections"],
  ["Dashboard: Arbeitsvorrat statt Zeilenzahl", "shared/portfolio-metrics.ts", "export function gewerkStandings"],
  ["Portfolio-Relief", "client/src/components/dashboard/PortfolioRelief.tsx", "relief-cell"],
  ["Relief drehbar und anklickbar", "client/src/components/dashboard/PortfolioRelief.tsx", "setPointerCapture"],
  ["Ask Bahn", "shared/agent/skills.ts", "export const SKILLS"],
];

console.log(bold("\nHEAD"));
for (const line of sh("git log --oneline -3").split("\n").filter(Boolean)) console.log(`  ${line}`);
const dirty = sh("git status --porcelain");
console.log(
  `  ${dirty ? red(`${dirty.split("\n").length} geanderte Datei(en) im Arbeitsverzeichnis`) : green("Arbeitsverzeichnis sauber")}`,
);

console.log(bold("\nWas im Code liegt"));
let missing = 0;
for (const [label, file, marker] of FEATURES) {
  const present = existsSync(file) && readFileSync(file, "utf8").includes(marker);
  if (!present) missing++;
  console.log(`  ${present ? green("OK") : red("FEHLT")}  ${label}`);
}

console.log(bold("\nWas gebaut ist"));
const DIST = "dist/public";
if (!existsSync(DIST)) {
  console.log(`  ${red("FEHLT")}  dist/public — bitte pnpm build`);
} else {
  const newest = (dir) => {
    let latest = 0;
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else latest = Math.max(latest, statSync(full).mtimeMs);
      }
    };
    walk(dir);
    return latest;
  };
  const builtAt = newest(DIST);
  const sourceAt = Math.max(newest("client/src"), newest("shared"));
  const stale = sourceAt > builtAt;
  console.log(
    `  ${stale ? red("ALT") : green("OK")}  dist/public von ${new Date(builtAt).toLocaleString("de-DE")}${stale ? red("  — alter als der Quellcode, bitte pnpm build") : ""}`,
  );
  const assets = readdirSync(path.join(DIST, "assets"));
  for (const [label, needle] of [
    ["Dashboard", "Dashboard-"],
    ["Projekte", "Projects-"],
    ["Gewerk-Workspace", "ReviewWorkspace-"],
    ["Anderungshistorie", "AuditLog-"],
  ]) {
    const hit = assets.find((a) => a.startsWith(needle) && a.endsWith(".js"));
    console.log(`     ${dim(`${label}: ${hit ?? "fehlt"}`)}`);
  }
  // A chunk that only the superseded build produced.
  const dead = assets.find((a) => a.startsWith("DepartmentReviewTable"));
  if (dead) console.log(`  ${red("ALT")}  ${dead} — dieser Build ist alter als die Gewerk-Workspaces`);
}

console.log(bold("\nErwartete Zahlen der Gates"));
for (const line of [
  "pnpm exec vitest run          255 passed",
  "node scripts/e2e-smoke.mjs     81 passed, 0 failed",
  "node scripts/check-ui.mjs      UI CLEAN",
  "node scripts/stress-test.mjs    8 passed, 0 failed",
  "pnpm exec biome check .        72 warnings (unverandert)",
]) console.log(dim(`  ${line}`));

console.log(
  missing === 0
    ? green("\nAlles angewendet.\n")
    : red(`\n${missing} Bauteil(e) fehlen — der letzte Patch ist nicht vollstandig angekommen.\n`),
);
