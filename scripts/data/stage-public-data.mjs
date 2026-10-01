#!/usr/bin/env node
/**
 * Stage the legacy snapshot files the static app and the tools read (client/public/data.json, schedule.json).
 *
 *   default                 fixtures/synthetic/*  — a SYNTHETIC dataset (same shape and statistics, invented
 *                           names/texts/numbers). This is what the repository ships and what CI uses.
 *   PRIVATE_DATA_DIR=<dir>  <dir>/data.json and <dir>/schedule.json — the real, internal export. It never enters
 *                           the repository: the staged copies are git-ignored and the directory is supplied by the
 *                           deployment (CI secret, BuildKit secret mount, operator's machine).
 *
 * Idempotent; run automatically before dev, build, tests and the e2e suites.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const priv = process.env.PRIVATE_DATA_DIR;
const src = priv ? path.resolve(priv) : path.join(root, "fixtures", "synthetic");
const dst = path.join(root, "client", "public");
mkdirSync(dst, { recursive: true });
for (const f of ["data.json", "schedule.json"]) {
  const from = path.join(src, f);
  if (!existsSync(from)) { console.error(`[data] ${from} not found${priv ? " (PRIVATE_DATA_DIR)" : ""}`); process.exit(1); }
  const to = path.join(dst, f);
  // skip the copy when nothing changed (keeps mtimes stable for watchers)
  if (!existsSync(to) || !readFileSync(to).equals(readFileSync(from))) copyFileSync(from, to);
}
writeFileSync(path.join(dst, ".data-source"), priv ? "private\n" : "synthetic\n");
console.log(`[data] staged ${priv ? "PRIVATE" : "synthetic"} dataset into client/public`);
