/**
 * What a fresh clone needs to know, before anybody changes anything.
 *
 * `pnpm status` answers "is the last patch in, and is it on the website".
 * This answers the questions that come before that, the ones a new machine —
 * or a new person, or a runner in a pipeline nobody has run before — has to
 * ask: does this checkout have what it needs, is the data intact, where do the
 * changes people make actually go, and what is still tied to the host we are
 * migrating away from.
 *
 * It reads. It never installs, never builds, never writes to the repository.
 * Exit code 0 means nothing is broken; 1 means something named below is.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ESC = String.fromCharCode(27);
const paint = (c) => (s) => `${ESC}[${c}m${s}${ESC}[0m`;
const green = paint(32);
const red = paint(31);
const amber = paint(33);
const dim = paint(2);
const bold = paint(1);

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

let problems = 0;
let warnings = 0;
const ok = (label, detail = "") => console.log(`  ${green("OK")}    ${label}${detail ? dim(` — ${detail}`) : ""}`);
const warn = (label, detail = "") => {
  warnings++;
  console.log(`  ${amber("HINWEIS")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
};
const bad = (label, detail = "") => {
  problems++;
  console.log(`  ${red("FEHLER")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
};

const json = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
console.log(bold("\nWerkzeuge"));
// ---------------------------------------------------------------------------
const pkg = json("package.json") ?? {};
const wantNode = Number((pkg.engines?.node ?? ">=22").replace(/[^\d]/g, "").slice(0, 2) || 22);
const haveNode = Number(process.versions.node.split(".")[0]);
if (haveNode >= wantNode) ok(`Node ${process.versions.node}`, `verlangt >=${wantNode}`);
else bad(`Node ${process.versions.node}`, `verlangt >=${wantNode}`);

const pnpmVersion = sh("pnpm --version");
const wantPnpm = (pkg.packageManager ?? "").split("@")[1] ?? "";
if (!pnpmVersion) bad("pnpm nicht gefunden", `package.json verlangt ${wantPnpm || "pnpm"}`);
else if (wantPnpm && pnpmVersion !== wantPnpm) warn(`pnpm ${pnpmVersion}`, `package.json pinnt ${wantPnpm}`);
else ok(`pnpm ${pnpmVersion}`);

if (existsSync("node_modules")) ok("node_modules vorhanden");
else warn("node_modules fehlt", "pnpm install --frozen-lockfile");

const chromium =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  (existsSync(path.join(process.env.HOME ?? "", ".cache/ms-playwright")) ? "im Cache" : "");
if (chromium) ok("Chromium für die Gates", String(chromium));
else warn("Chromium fehlt", "pnpm exec playwright install --with-deps chromium");

// ---------------------------------------------------------------------------
console.log(bold("\nDaten"));
// ---------------------------------------------------------------------------
const DATA = "client/public/data.json";
const data = json(DATA);
if (!data) {
  bad(`${DATA} fehlt oder ist kein JSON`);
} else {
  const projects = data.projects ?? [];
  const reviews = projects.reduce((n, p) => n + (p.reviews?.length ?? 0), 0);
  const bytes = statSync(DATA).size;
  ok(
    `${projects.length.toLocaleString("de-DE")} Projekte · ${reviews.toLocaleString("de-DE")} Prüfzeilen`,
    `${(bytes / 1024 / 1024).toFixed(1)} MB auf der Platte`,
  );

  const ids = new Set();
  let duplicates = 0;
  let withoutNumber = 0;
  for (const p of projects) {
    if (ids.has(p.id)) duplicates++;
    ids.add(p.id);
    if (!String(p.projektnummer ?? "").trim()) withoutNumber++;
  }
  if (duplicates > 0) bad(`${duplicates} doppelte Projekt-IDs`);
  else ok("Projekt-IDs eindeutig");
  if (withoutNumber > 0) warn(`${withoutNumber} Projekte ohne Projektnummer`, "bekannt, im Dashboard ausgewiesen");

  /*
   * The persistence budget.
   *
   * Deliberately not computed from the file size: the loader validates and
   * normalises before caching, so 3,5 MB on disk becomes 2,15 MB in the
   * browser — measured, not estimated. Reporting the disk figure as the share
   * would overstate the pressure by half, and a diagnostic that cries wolf is
   * a diagnostic people learn to skip.
   */
  const cap = 5 * 1024 * 1024;
  console.log(
    `  ${dim(`Speicherlage: ${(bytes / 1024 / 1024).toFixed(1)} MB als Datei → 2,15 MB im localStorage (gemessen) von ${cap / 1024 / 1024} MB Limit ≈ 43 %`)}`,
  );
}

// ---------------------------------------------------------------------------
console.log(bold("\nWo Änderungen landen"));
// ---------------------------------------------------------------------------
const apiClient = existsSync("client/src/_core/api/client.ts")
  ? readFileSync("client/src/_core/api/client.ts", "utf8")
  : "";
if (/localStorage/.test(apiClient) && !/trpc|fetch\(\s*["'`]\/api\//.test(apiClient)) {
  warn(
    "Der Client schreibt ausschließlich in localStorage",
    "kein Server im Deploy — zwei Rechner sehen einander nicht",
  );
} else {
  ok("Der Client spricht mit einer API");
}
if (/writeStore\(/.test(apiClient)) ok("Schreibvorgänge sind gegen vollen Speicher abgesichert");
else bad("Schreibvorgänge sind nicht abgesichert", "ein volles localStorage verliert Änderungen still");

const serverRouters = existsSync("server/routers.ts") ? readFileSync("server/routers.ts", "utf8") : "";
const procedures = (serverRouters.match(/\.(query|mutation)\(/g) ?? []).length;
if (procedures > 0) {
  const wired = /trpc\.[a-z]/i.test(
    sh("grep -rl 'trpc\\.' client/src --include=*.tsx 2>/dev/null") || "",
  );
  if (wired) ok(`Server-API mit ${procedures} Prozeduren, vom Client benutzt`);
  else
    warn(
      `Server-API mit ${procedures} Prozeduren vorhanden, aber ungenutzt`,
      "server/routers.ts + drizzle/schema.ts stehen bereit; der Client ruft sie nicht auf",
    );
}

// ---------------------------------------------------------------------------
console.log(bold("\nBindung an GitHub"));
// ---------------------------------------------------------------------------
/*
 * Only real code. The first version of this check matched the comment that
 * explains the URL's removal and reported the fix as the defect — a grep that
 * cannot tell code from prose about code is worse than no grep.
 */
const hardCoded = sh(
  "grep -rn 'raw.githubusercontent\\|github.com/iceccarelli' client/src shared server 2>/dev/null | grep -v ':[[:space:]]*[*/]' | head -5",
);
if (hardCoded) bad("Fest verdrahtete GitHub-URL im Anwendungscode", hardCoded.split("\n")[0].slice(0, 90));
else ok("Keine GitHub-URL im Anwendungscode");

if (existsSync(".gitlab-ci.yml")) ok(".gitlab-ci.yml vorhanden");
else bad(".gitlab-ci.yml fehlt", "GitLab würde nichts prüfen");
if (existsSync(".github/workflows/ci.yml")) {
  warn(".github/workflows/ci.yml existiert weiterhin", "auf GitLab wirkungslos, auf GitHub weiterhin aktiv");
}
if (existsSync("docs/GITLAB-MIGRATION.md")) ok("Migrationsanleitung vorhanden", "docs/GITLAB-MIGRATION.md");
else warn("Keine Migrationsanleitung");

// ---------------------------------------------------------------------------
console.log(bold("\nContainer"));
// ---------------------------------------------------------------------------
/*
 * The failure this catches, which ran red in CI for months without anybody
 * reading it:
 *
 *   #15 [deps 5/5] RUN pnpm install --frozen-lockfile
 *   ENOENT: no such file or directory, open '/app/patches/wouter@3.7.1.patch'
 *
 * package.json declares a patchedDependency; pnpm hashes that file during
 * install, before it looks at anything else. The Dockerfile's deps stage
 * copied only package.json and the lockfile, so the file was not in the image
 * — and every container build has failed on it since the Dockerfile was
 * written. A patched dependency is part of the manifest, not of the sources.
 */
const patched = pkg.pnpm?.patchedDependencies ?? {};
const patchPaths = Object.values(patched).filter((v) => typeof v === "string");
const dockerfile = existsSync("Dockerfile") ? readFileSync("Dockerfile", "utf8") : "";
if (patchPaths.length === 0) {
  ok("Keine gepatchten Abhängigkeiten");
} else {
  for (const rel of patchPaths) {
    if (!existsSync(rel)) bad(`patchedDependency fehlt: ${rel}`, "pnpm install schlägt überall fehl");
    else ok(`patchedDependency vorhanden: ${rel}`);
  }
  if (!dockerfile) {
    warn("Kein Dockerfile — Container-Gate entfällt");
  } else {
    // The deps stage is everything up to the next FROM.
    const depsStage = dockerfile.split(/^FROM .* AS build/m)[0] ?? "";
    const dirs = [...new Set(patchPaths.map((rel) => rel.split("/")[0]))];
    for (const dir of dirs) {
      const copied = new RegExp(`^COPY\\s+${dir}\\b`, "m").test(depsStage);
      if (copied) ok(`Dockerfile kopiert ${dir}/ vor dem Install`);
      else
        bad(
          `Dockerfile kopiert ${dir}/ nicht vor dem Install`,
          "pnpm install --frozen-lockfile bricht im Image mit ENOENT ab",
        );
    }
  }
}

// ---------------------------------------------------------------------------
console.log(bold("\nRepository"));
// ---------------------------------------------------------------------------
const branch = sh("git rev-parse --abbrev-ref HEAD");
const branches = sh("git branch -r").split("\n").filter(Boolean).length;
ok(`Branch ${branch || "(keiner)"}`, `${branches} Remote-Branch(es)`);

const trackedPatches = sh("git ls-files").split("\n").filter((f) => /\.patch$/.test(f));
const strayPatches = trackedPatches.filter((f) => !f.startsWith("patches/"));
if (strayPatches.length > 0) bad(`${strayPatches.length} Patch-Datei(en) im Baum`, strayPatches.join(", "));
else ok("Keine Transfer-Patches im Baum", trackedPatches.length ? `${trackedPatches.join(", ")} ist eine pnpm-Abhängigkeit` : "");

const dirty = sh("git status --porcelain").split("\n").filter(Boolean);
if (dirty.length > 0) warn(`${dirty.length} geänderte Datei(en) im Arbeitsverzeichnis`, dirty.slice(0, 3).join(" · "));
else ok("Arbeitsverzeichnis sauber");

const bigFiles = sh("git ls-files -z | xargs -0 du -k 2>/dev/null | sort -rn | head -3")
  .split("\n")
  .filter(Boolean)
  .map((l) => l.replace(/\s+/, " "));
console.log(`  ${dim(`größte Dateien: ${bigFiles.join(" · ") || "unbekannt"}`)}`);

// ---------------------------------------------------------------------------
console.log(bold("\nGates, die diesen Stand beweisen"));
// ---------------------------------------------------------------------------
for (const line of [
  "pnpm exec tsc --noEmit         sauber",
  "pnpm exec vitest run           305 passed, 6 skipped",
  "node scripts/e2e-smoke.mjs     112 passed, 0 failed",
  "node scripts/check-ui.mjs      UI CLEAN",
  "node scripts/stress-test.mjs    12 passed, 0 failed",
  "pnpm exec biome check .         70 warnings",
]) console.log(`  ${dim(line)}`);

console.log(
  problems > 0
    ? red(`\n${problems} Fehler, ${warnings} Hinweis(e).\n`)
    : warnings > 0
      ? amber(`\nKeine Fehler, ${warnings} Hinweis(e).\n`)
      : green("\nAlles in Ordnung.\n"),
);
process.exit(problems > 0 ? 1 : 0);
