/**
 * The mutation-plane guard. There is ONE way to change business state: router → domain service → ProjectTx (one DB
 * transaction: optimistic version/idempotency → audit → outbox event → read models). This test makes that a property of the
 * repository instead of a claim: it fails when a new writer, mutation procedure or write route appears without being
 * classified here, and when a layer that must never write (routers, domain services, client) starts writing.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as schema from "../drizzle/schema";
import { getTableName } from "drizzle-orm";
import { appRouter } from "./routers";

const root = path.resolve(__dirname, "..");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (["node_modules", "testing"].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const sources = (dir: string, re = /\.(ts|tsx|mjs)$/) => walk(path.join(root, dir)).filter(f => re.test(f) && !/\.test\.tsx?$/.test(f));
const rel = (f: string) => path.relative(root, f);

const tables = Object.values(schema).flatMap(v => { try { return [getTableName(v as never)]; } catch { return []; } });
const tableExports = Object.entries(schema).filter(([, v]) => { try { getTableName(v as never); return true; } catch { return false; } }).map(([k]) => k);
const SQL_WRITE = /\b(INSERT\s+INTO|UPDATE\s+[`\w]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i;
const ORM_WRITE = new RegExp(`\\.(insert|update|delete)\\(\\s*(?:${tableExports.join("|")})\\s*\\)`);
const writes = (f: string) => { const t = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); return SQL_WRITE.test(t) || ORM_WRITE.test(t); };

/** Every server file that contains a DB write, and why it is allowed to. */
const WRITERS: Record<string, string> = {
  "server/infra/mysqlProjectStore.ts": "the domain transaction adapter (ProjectTx): aggregate writes + audit + outbox + idempotency; personal state (watchers, notification read flips)",
  "server/infra/readModels.ts": "derived rm_* counters, maintained inside the domain transaction; rebuild is the repair/test oracle",
  "server/infra/geoModel.ts": "derived project_geo, maintained inside the domain transaction; rebuild at migration",
  "server/infra/mysqlOutbox.ts": "relay infrastructure: assigns feedSeq / marks events processed or dead-lettered",
  "server/infra/notificationRetention.ts": "retention purge of delivered notifications (single cluster-wide runner)",
  "server/_core/identity.ts": "mirror of verified identities + audit of authorization-grant changes, one transaction",
  "server/db.ts": "development-only upsertUser (demo login / legacy OAuth; neither exists in production)",
  "server/seed.mjs": "operator seed script; refuses to run in production",
};
/** Layers that must NEVER touch tables directly. */
const MUST_NOT_WRITE = ["server/routers.ts", "server/excel.ts"];

describe("one mutation plane", () => {
  it("every DB writer in server/ is a known, classified one", () => {
    const found = sources("server").filter(writes).map(rel).sort();
    expect(found.filter(f => !(f in WRITERS)), "unclassified writer: route it through ProjectService/ProjectTx or classify it here with a reason").toEqual([]);
    expect(Object.keys(WRITERS).filter(f => !found.includes(f)), "stale allowlist entry (file no longer writes)").toEqual([]);
  });

  it("routers and domain services never write tables directly (they go through ProjectTx)", () => {
    for (const f of [...MUST_NOT_WRITE, ...sources("server/domain").map(rel)]) expect(writes(path.join(root, f)), `${f} writes directly`).toBe(false);
  });

  it("shared/ and client/ contain no database access", () => {
    for (const f of [...sources("shared"), ...sources("client/src")]) {
      const t = fs.readFileSync(f, "utf8");
      expect(/^\s*(import|export)\b[^;]*?from\s+["'](drizzle-orm[^"']*|mysql2[^"']*|[./@]*\/?drizzle\/[^"']*)["']/m.test(t), `${rel(f)} imports the database layer`).toBe(false);
    }
  });

  it("every tRPC mutation is classified; nothing else can mutate", () => {
    const CLASS: Record<string, string> = {
      "projects.create": "domain: ProjectService.create (tx, version, audit, event)",
      "projects.update": "domain: ProjectService.update",
      "projects.updateReview": "domain: ProjectService.updateReview (project version bump)",
      "projects.createReview": "domain: ProjectService.createReview",
      "projects.delete": "domain: ProjectService.delete (snapshot in audit)",
      "bookings.book": "domain: BookingService.book",
      "bookings.release": "domain: BookingService.release",
      "checklists.save": "domain: ChecklistService.save",
      "checklists.submit": "domain: ChecklistService.submit (creates project + reviews through createWithin)",
      "audit.record": "audit-only document action (authorized like a read, closed vocabulary)",
      "projects.sync": "read (a mutation only to carry a large body)",
      "projects.watch": "personal subscription state (own row, project must be visible)",
      "notifications.markRead": "personal state (own notifications)",
      "auth.logout": "clears the (development-only) session cookie",
      "auth.demoLogin": "development only: NOT_FOUND in production, boot refuses ALLOW_DEMO_LOGIN",
    };
    const mutations = Object.entries((appRouter as any)._def.procedures).filter(([, v]: any) => v._def.type === "mutation").map(([k]) => k).sort();
    expect(mutations.filter(m => !(m in CLASS)), "unclassified mutation procedure").toEqual([]);
    expect(Object.keys(CLASS).filter(m => !mutations.includes(m)), "stale classification").toEqual([]);
  });

  it("the only HTTP write routes are ephemeral realtime state (no SQL), plus tRPC", () => {
    const routes: string[] = [];
    for (const f of sources("server")) for (const m of fs.readFileSync(f, "utf8").matchAll(/\b(?:app|router)\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)/g)) routes.push(`${m[1]!.toUpperCase()} ${m[2]} (${rel(f)})`);
    expect(routes.sort()).toEqual([
      "DELETE /api/realtime/presence (server/realtime/gateway.ts)",
      "POST /api/realtime/presence (server/realtime/gateway.ts)",
      "POST /api/realtime/scopes (server/realtime/gateway.ts)",
    ]);
    expect(writes(path.join(root, "server/realtime/gateway.ts"))).toBe(false);
  });

  it("the scan itself sees the schema's tables (guards against a silently empty scan)", () => {
    expect(tables).toEqual(expect.arrayContaining(["projects", "department_reviews", "audit_log", "domain_events", "users"]));
  });
});
