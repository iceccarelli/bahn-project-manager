/**
 * Authenticated route for the legacy snapshot files (data.json, schedule.json) in server-mode builds.
 *
 * Pages that are not yet server-authoritative (Dashboard, BVB-EEA, PSV-ITK, Anmeldung, Audit) still read
 * the static snapshot. In a server deployment that file is NOT public: it is served only to a principal
 * who may see every workspace. A workspace-restricted principal gets 403 (default-deny), an anonymous
 * caller 401. This keeps the snapshot from becoming a side door around the project API's authorization.
 */
import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { resolveIdentity } from "./identity";
import { workspaceRestriction } from "../domain/permissions";

export const LEGACY_FILES = ["data.json", "schedule.json"] as const;

export function registerLegacySnapshot(app: Express, publicDir: string) {
  const legacyDir = path.resolve(publicDir, "..", "legacy");
  for (const f of LEGACY_FILES) {
    app.get(`/${f}`, async (req, res, next) => {
      const file = path.join(legacyDir, f);
      // Not a server-mode build (static file still in public/, e.g. local dev): fall through to static.
      if (!fs.existsSync(file)) return next();
      const id = await resolveIdentity(req).catch(() => null);
      if (!id) { res.status(401).json({ error: "unauthenticated" }); return; }
      if (workspaceRestriction(id.principal) !== null) { res.status(403).json({ error: "forbidden" }); return; }
      res.setHeader("Cache-Control", "private, no-store");
      res.sendFile(file);
    });
  }
}
