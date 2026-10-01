#!/usr/bin/env node
/**
 * Fails (exit 1) when a browser-perf result exceeds the committed budgets.
 *   node scripts/perf/check-thresholds.mjs artifacts/browser-perf-after.json [scripts/perf/thresholds.json]
 * A missing metric (e.g. the map never produced a marker) is a failure, not a pass.
 */
import fs from "node:fs";

const [resultPath, thresholdPath = "scripts/perf/thresholds.json"] = process.argv.slice(2);
if (!resultPath) { console.error("usage: check-thresholds.mjs <result.json> [thresholds.json]"); process.exit(2); }
const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const budgets = Object.entries(JSON.parse(fs.readFileSync(thresholdPath, "utf8"))).filter(([k]) => !k.startsWith("_"));
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);

let failed = 0;
for (const [metric, { max, baseline }] of budgets) {
  const v = get(result, metric);
  const ok = typeof v === "number" && Number.isFinite(v) && v <= max;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${metric.padEnd(28)} ${String(v ?? "missing").padStart(8)}  (budget ${max}, baseline ${baseline})`);
}
console.log(failed ? `\n${failed} budget(s) exceeded` : "\nall UI performance budgets met");
process.exit(failed ? 1 : 0);
