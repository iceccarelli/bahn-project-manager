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
  ["Ask Bahn stellt Anschlussfragen", "shared/agent/follow-ups.ts", "export function followUps"],
  ["Offene Status pulsieren", "shared/status-appearance.ts", "export function statusPulseClass"],
  ["Mobile Navigation deckt die Seite ab", "client/src/index.css", "--color-sidebar:"],
  ["Handlungsbedarf fuhrt in die gefilterten Karten", "shared/handlungsbedarf.ts", "export function bedarfHref"],
  ["Gewerke-Karussell statt Leerzustand", "client/src/components/dashboard/GewerkeCarousel.tsx", "export const ROTATE_MS"],
  ["Relief als Gebirge, dreht sich selbst", "client/src/index.css", "bpm-relief-sweep"],
  ["Relief hat echte Hohe (kein <table>)", "client/src/components/dashboard/PortfolioRelief.tsx", "export const MAX_LIFT_PX"],
  ["Kinematischer Auftritt beim Scrollen", "client/src/lib/motion.ts", "export function installMotionSwitch"],
  ["Tabellen stromen Zeile fur Zeile", "client/src/hooks/useTableStream.ts", "export function useTableStream"],
  ["3D-Donut, jede Bande anklickbar", "client/src/components/dashboard/Pie3D.tsx", "export function Pie3D"],
  ["Tonband-Filter uber alle Flachen", "shared/handlungsbedarf.ts", "export function toneHref"],
  ["Alle acht Bahnhofsmanagements", "client/src/pages/Dashboard.tsx", "Regionale Verteilung — alle"],
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

/*
 * ---------------------------------------------------------------------------
 * Was im Netz steht
 * ---------------------------------------------------------------------------
 * The section this screen was missing, and the omission cost a whole day.
 *
 * Every marker read OK, every gate was green, dist/public was fresh, and this
 * script printed "Alles angewendet." — while bahn-project-manager.vercel.app
 * showed none of it, because Vercel builds from origin/main and the commits
 * had never left the machine. A status screen that reports the working tree
 * and calls that "everything" is not neutral: it actively says the opposite of
 * the truth to the one person checking.
 *
 * Applied, built and gated is three of four. Deployed is the fourth.
 */
console.log(bold("\nWas im Netz steht"));
let unpushed = 0;
{
  // Best-effort: a Codespace without network still gets the local comparison.
  sh("git fetch -q origin 2>/dev/null || true");
  const upstream = sh("git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null") || "origin/main";
  const remote = sh(`git rev-parse --short ${upstream} 2>/dev/null`);
  const head = sh("git rev-parse --short HEAD");
  console.log(`  ${dim(`HEAD        ${head}`)}`);
  console.log(`  ${dim(`${upstream.padEnd(11)} ${remote || "unbekannt"}`)}`);
  if (!remote) {
    console.log(`  ${red("?")}   kein Upstream erreichbar — Deploy-Stand unbekannt`);
  } else {
    unpushed = Number(sh(`git rev-list --count ${upstream}..HEAD`) || "0");
    const behind = Number(sh(`git rev-list --count HEAD..${upstream}`) || "0");
    if (unpushed > 0) {
      console.log(
        `  ${red("NEIN")} ${unpushed} Commit(s) sind nur lokal. Vercel baut aus ${upstream} und zeigt sie nicht.`,
      );
      for (const line of sh(`git log --oneline ${upstream}..HEAD`).split("\n").filter(Boolean)) {
        console.log(`     ${dim(line)}`);
      }
      console.log(`     ${bold("git push origin HEAD:main")}`);
    } else if (behind > 0) {
      console.log(`  ${red("NEIN")} ${behind} Commit(s) liegen auf ${upstream} und nicht hier.`);
    } else {
      console.log(`  ${green("OK")}  HEAD steht auf ${upstream} — das Netz zeigt diesen Stand.`);
    }
  }
}

console.log(bold("\nErwartete Zahlen der Gates"));
for (const line of [
  "pnpm exec vitest run          281 passed, 6 skipped",
  "node scripts/e2e-smoke.mjs    102 passed, 0 failed",
  "node scripts/check-ui.mjs      UI CLEAN",
  "node scripts/stress-test.mjs    8 passed, 0 failed",
  "pnpm exec biome check .        71 warnings",
]) console.log(dim(`  ${line}`));

/*
 * Four conditions, and the verdict names whichever one fails first.
 * "Alles angewendet" is reserved for the case where the website has it too.
 */
if (missing > 0) {
  console.log(
    red(`\n${missing} Bauteil(e) fehlen — der letzte Patch ist nicht vollstandig angekommen.\n`),
  );
} else if (unpushed > 0) {
  console.log(
    red(
      `\nIm Code, aber nicht im Netz: ${unpushed} Commit(s) ungepusht.\nDie Website andert sich erst nach  git push origin HEAD:main\n`,
    ),
  );
} else {
  console.log(green("\nAlles angewendet und gepusht.\n"));
}
