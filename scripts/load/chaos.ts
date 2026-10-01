/**
 * Fault-injection convergence test (LOCAL resilience evidence, not a load certification).
 *
 * N real clients (the production RealtimeConnection + ProjectSyncEngine) track a set of projects
 * across two server instances sharing MySQL + Redis while a writer commits continuously. Faults:
 *   1 baseline · 2 instance restart (relay leader may be the victim) · 3 Redis restart ·
 *   4 database stall (SIGSTOP mariadbd) · 5 reconnect storm (both instances restart at once)
 * After each fault the test waits for EVERY client to converge on the database's versions and
 * checks: no lost writes, outbox drained, no dead letters, gapless feed.
 *
 *   tsx scripts/load/chaos.ts [--clients 300] [--db mysql://…/bahn_chaos] [--redis redis://127.0.0.1:6390]
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { ProjectSyncEngine } from "../../client/src/realtime/projectSyncEngine";
import { RealtimeConnection } from "../../client/src/realtime/connection";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1]! : d; };
const N = Number(arg("clients", "300"));
const DB_BASE = arg("db-base", "mysql://bahn:bahn@127.0.0.1:3306"), DB = "bahn_chaos";
const REDIS_URL = arg("redis", "redis://127.0.0.1:6390"), REDIS_PORT = new URL(REDIS_URL).port;
const PORTS = [3300, 3301];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const report: any = { clients: N, scenarios: [] };

// ---- database ---------------------------------------------------------------------------------
const admin = await mysql.createConnection(DB_BASE);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``); await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); await admin.end();
const setup = await mysql.createConnection(`${DB_BASE}/${DB}`);
for (const f of readdirSync("drizzle").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort())
  for (const s of readFileSync(path.join("drizzle", f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await setup.query(s);
const rows = Array.from({ length: 10 }, (_, i) => [`C-${i}`, "Frankfurt", `Chaos ${i}`, "AP"]);
await setup.query("INSERT INTO projects (projektnummer,bahnhofsmanagement,station,projektstand) VALUES ?", [rows]);
await setup.end();
const db = mysql.createPool({ uri: `${DB_BASE}/${DB}`, connectionLimit: 3, timezone: "Z" });
const q = async (sql: string, a: unknown[] = []) => (await db.query(sql, a))[0] as any[];
const IDS: number[] = (await q("SELECT id FROM projects ORDER BY id")).map(r => r.id);

// ---- IdP + token + servers ----------------------------------------------------------------------
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "c", alg: "RS256", use: "sig" };
const idp = createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
await new Promise<void>(r => idp.listen(0, "127.0.0.1", r));
const ISS = `http://127.0.0.1:${(idp.address() as any).port}/`, AUD = "bahn-chaos";
const token = await new SignJWT({ tid: "t", oid: "chaos", name: "Chaos", roles: ["admin"] }).setProtectedHeader({ alg: "RS256", kid: "c" }).setIssuer(ISS).setAudience(AUD).setExpirationTime("3h").sign(privateKey);

const procs = new Map<number, ChildProcess>();
const start = async (port: number) => {
  const p = spawn("node", ["dist-e2e/index.js"], { env: { ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_URL: `${DB_BASE}/${DB}`, JWT_SECRET: "c".repeat(48),
    OIDC_ISSUER: ISS, OIDC_AUDIENCE: AUD, OIDC_JWKS_URI: `${ISS}jwks`, REDIS_URL, RT_MAX_PER_PRINCIPAL: "100000", RT_MAX_CONNECTIONS: "100000", DB_POOL_SIZE: "10" }, stdio: "ignore" });
  procs.set(port, p);
  for (let i = 0; i < 100; i++) { if ((await fetch(`http://127.0.0.1:${port}/api/ready`).catch(() => null))?.ok) return; await sleep(200); }
  throw new Error(`server ${port} did not start`);
};
const stop = (port: number, sig: NodeJS.Signals = "SIGKILL") => { procs.get(port)?.kill(sig); procs.delete(port); };
for (const p of PORTS) await start(p);
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const api = async (port: number, proc: string, input: unknown, method: "GET" | "POST" = "POST", timeoutMs = 4000) => {
  const url = method === "GET" ? `http://127.0.0.1:${port}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `http://127.0.0.1:${port}/api/trpc/${proc}`;
  const r = await fetch(url, { method, headers: H, ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}), signal: AbortSignal.timeout(timeoutMs) });
  const j: any = await r.json(); return { status: r.status, data: j.result?.data?.json, error: j.error?.json };
};

// ---- clients ----------------------------------------------------------------------------------------
interface C { engine: ProjectSyncEngine; conn: RealtimeConnection; port: number }
const clients: C[] = [];
for (let i = 0; i < N; i++) {
  const port = PORTS[i % PORTS.length]!;
  const call = async (proc: string, input: unknown, method: "GET" | "POST") => { const r = await api(port, proc, input, method, 8000); if (r.status !== 200) throw new Error(`${proc} ${r.status}`); return r.data; };
  const engine = new ProjectSyncEngine({ sync: known => call("projects.sync", { known }, "POST"), changes: input => call("projects.changes", input, "GET") });
  const conn = new RealtimeConnection({ url: `http://127.0.0.1:${port}/api/realtime/stream`, heartbeatMs: 15_000, backoff: { baseMs: 300, maxMs: 4000 },
    getHeaders: () => ({ authorization: `Bearer ${token}` }), onEvent: e => { engine.applyEvent(e); },
    onSync: ({ headSeq, reconnecting }) => (reconnecting ? engine.resync(headSeq ?? undefined) : engine.catchUp(headSeq ?? undefined)) });
  conn.setScopes(["workspace:frankfurt"]);
  // the app runs this reconcile every 30 s (RealtimeProvider); 5 s here so a short test exercises it
  setInterval(() => { void engine.catchUp().catch(() => {}); }, 5000).unref();
  clients.push({ engine, conn, port });
}
{ // seed every client from an authoritative read (cursor before snapshot, like a list read)
  const page = (await api(PORTS[0]!, "projects.list", { limit: 100, expand: [] }, "GET")).data;
  const details = await Promise.all(IDS.map(async id => (await api(PORTS[0]!, "projects.get", { id }, "GET")).data));
  for (const c of clients) { c.engine.initCursor(page.feedHead); for (const d of details) c.engine.seed(d, { silent: true }); c.conn.start(); }
}
await sleep(3000);

// ---- writer ---------------------------------------------------------------------------------------------
let writing = false, ok = 0, failed = 0, conflicts = 0;
let writerP: Promise<void> = Promise.resolve();
function startWriter() {
  writing = true;
  writerP = (async () => {
    let n = 0;
    while (writing) {
      const id = IDS[n % IDS.length]!; const port = PORTS[n % PORTS.length]!; n++;
      try {
        const [{ v }] = await q("SELECT syncVersion v FROM projects WHERE id=?", [id]).catch(() => [{ v: 1 }]);
        const r = await api(port, "projects.update", { id, expectedVersion: v, changes: { kommentar: `w${Date.now()}` }, idempotencyKey: `chaos-${Date.now()}-${n}-${Math.random().toString(36).slice(2)}` }, "POST", 3000);
        if (r.status === 200) ok++; else if (r.status === 409) conflicts++; else failed++;
      } catch { failed++; }
      await sleep(40);
    }
  })();
}

const dbVersions = async () => new Map((await q("SELECT id, syncVersion v FROM projects")).map((r: any) => [r.id as number, r.v as number]));
const converged = async () => { const truth = await dbVersions(); let behind = 0; for (const c of clients) for (const [id, v] of truth) if ((c.engine.serverVersion(id) ?? 0) !== v) behind++; return behind; };

async function scenario(name: string, fault: () => Promise<void>, recoverWaitMs = 90_000) {
  const before = { ok, failed, conflicts };
  startWriter();
  await sleep(3000);
  await fault();
  const faultDone = Date.now();
  // keep writing through the recovery window, then stop the writer briefly to define "the truth"
  await sleep(4000);
  writing = false; await writerP;
  let behind = -1, tConv = 0;
  for (let waited = 0; waited < recoverWaitMs; waited += 500) { behind = await converged(); if (behind === 0) { tConv = Date.now() - faultDone; break; } await sleep(500); }
  const [{ backlog }] = await q("SELECT COUNT(*) backlog FROM domain_events WHERE processedAt IS NULL");
  const [{ dead }] = await q("SELECT COUNT(*) dead FROM domain_events WHERE failedAt IS NOT NULL");
  const [{ lo, hi, n }] = await q("SELECT MIN(feedSeq) lo, MAX(feedSeq) hi, COUNT(feedSeq) n FROM domain_events");
  const [{ events }] = await q("SELECT COUNT(*) events FROM domain_events WHERE aggregateType='project' AND aggregateVersion>1");
  const [{ audits }] = await q("SELECT COUNT(DISTINCT eventId) audits FROM audit_log WHERE eventId IS NOT NULL AND action='update'");
  const states = clients.reduce((m: Record<string, number>, c) => (m[c.conn.getStatus().state] = (m[c.conn.getStatus().state] ?? 0) + 1, m), {});
  const row = { scenario: name, clientsBehindAfterRecovery: behind, secondsToConverge: behind === 0 ? +(tConv / 1000).toFixed(1) : null,
    writes: { ok: ok - before.ok, failedDuringFault: failed - before.failed, conflicts: conflicts - before.conflicts },
    outboxBacklog: Number(backlog), deadLetters: Number(dead), feedGapless: Number(hi) - Number(lo) + 1 === Number(n), updateEventsEqAuditedUpdates: Number(events) === Number(audits), connectionStates: states };
  report.scenarios.push(row); console.log(JSON.stringify(row));
}

const scenarios: Array<[string, () => Promise<void>]> = [
  ["baseline (no fault)", async () => {}],
  ["instance restart (SIGKILL + start, alternating instance)", async () => { stop(PORTS[0]!); await sleep(1500); await start(PORTS[0]!); }],
  ["Redis restart (4 s outage)", async () => { execSync(`redis-cli -p ${REDIS_PORT} shutdown nosave || true`, { stdio: "ignore" }); await sleep(4000); spawn("redis-server", ["--port", REDIS_PORT, "--save", "", "--appendonly", "no"], { stdio: "ignore", detached: true }).unref(); await sleep(1500); }],
  ["database stall (SIGSTOP mariadbd 6 s)", async () => { const pid = execSync("pgrep -x mariadbd || pgrep -x mysqld").toString().trim().split("\n")[0]!; execSync(`kill -STOP ${pid}`); await sleep(6000); execSync(`kill -CONT ${pid}`); }],
  ["reconnect storm (both instances SIGKILL + restart)", async () => { for (const p of PORTS) stop(p); await sleep(1500); await Promise.all(PORTS.map(start)); }],
];
for (const [name, fault] of scenarios) await scenario(name, fault);
report.finalWrites = { ok, failed, conflicts };
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/chaos-local.json", JSON.stringify({ ...report, finishedAt: new Date().toISOString(), note: "local single-host fault injection; not a load certification" }, null, 2));
for (const c of clients) c.conn.stop();
for (const p of PORTS) stop(p, "SIGTERM"); idp.close(); await db.end();
const bad = report.scenarios.filter((s: any) => s.clientsBehindAfterRecovery !== 0 || s.outboxBacklog !== 0 || s.deadLetters !== 0 || !s.feedGapless);
console.log(bad.length ? `FAILED ${bad.length} scenario(s)` : "ALL SCENARIOS CONVERGED");
process.exit(bad.length ? 1 : 0);
