/**
 * Serving the built client. No dev server, no bundler, nothing from vite.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own file
 * ---------------------------------------------------------------------------
 * `serveStatic` used to live next to `setupVite`, which imports `vite` and
 * `vite.config.ts` at module scope. Production never calls setupVite — the
 * branch in index.ts is guarded by NODE_ENV — but an ESM import is resolved
 * when the module loads, not when the branch runs. The production image
 * installs production dependencies only, and vite is a devDependency, so the
 * container died on its first line:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite'
 *   imported from /app/dist/index.js
 *
 * curl retried thirty times against a process that had already exited. The
 * split is the fix: production imports this file, development imports the
 * other one — and only development.
 */
import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
