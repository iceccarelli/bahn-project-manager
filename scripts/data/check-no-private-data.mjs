#!/usr/bin/env node
/**
 * CI guard: fail if a tracked file looks like the real internal data or contact directory.
 * (1) forbidden paths, (2) business e-mail addresses of the operator, (3) the operator's SharePoint tenant.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const forbidden = [/^client\/public\/(data|schedule)\.json$/, /^data\/(contacts\.(source|report)|normalize-report|schedule\.report)\.json$/, /^data\/.*\.xlsm$/, /^dist/, /ChecklisteBeispiel\.pdf$/];
const problems = [];
for (const f of tracked) if (forbidden.some(r => r.test(f))) problems.push(`forbidden tracked path: ${f}`);
const SENSITIVE = [/[A-Za-z0-9._%+-]+@deutschebahn\.com/gi, /dbsw\.sharepoint\.com/gi];
const ALLOWED_MAIL = /^(noreply|no-reply|vorname\.nachname)@deutschebahn\.com$/i; // generic placeholders used in prose/tests
for (const f of tracked) {
  if (!/\.(ts|tsx|mjs|js|json|md|html|sh|yml|yaml|txt)$/.test(f) || /^(pnpm-lock|drizzle\/meta)/.test(f)) continue;
  let t; try { t = readFileSync(f, "utf8"); } catch { continue; }
  for (const re of SENSITIVE) for (const m of t.matchAll(re)) if (!ALLOWED_MAIL.test(m[0])) problems.push(`${f}: ${m[0]}`);
}
if (problems.length) { console.error(`private-data guard failed:\n  ${[...new Set(problems)].join("\n  ")}`); process.exit(1); }
console.log("private-data guard: clean");
