#!/usr/bin/env node
/**
 * Smoke test for a DEPLOYED server-mode instance. Exercises the real deployed system, not a mock.
 *   STAGING_URL=https://staging.example SMOKE_TOKEN=<oidc access token> node scripts/gate/staging-smoke.mjs
 * Prints one JSON document; exit 0 only if every check passed. Without SMOKE_TOKEN the authenticated
 * checks are reported as "not-run" and the overall result is NOT a pass.
 */
const url = (process.env.STAGING_URL ?? process.argv[2] ?? "").replace(/\/$/, "");
const token = process.env.SMOKE_TOKEN;
if (!url) { console.error("STAGING_URL required"); process.exit(2); }
const results = [];
const check = async (name, fn) => {
  const t0 = performance.now();
  try { const detail = await fn(); results.push({ name, status: "pass", ms: Math.round(performance.now() - t0), ...(detail ? { detail } : {}) }); }
  catch (e) { results.push({ name, status: "fail", ms: Math.round(performance.now() - t0), detail: String(e.message ?? e) }); }
};
const skip = name => results.push({ name, status: "not-run", detail: "needs SMOKE_TOKEN" });
const auth = token ? { authorization: `Bearer ${token}` } : {};
const trpc = async (proc, input, method = "GET", anon = false) => {
  const a = anon ? {} : auth;
  const r = await fetch(method === "GET" ? `${url}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `${url}/api/trpc/${proc}`,
    { method, headers: { ...a, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.result?.data?.json, error: j.error?.json };
};

await check("transport is HTTPS (or explicitly local)", async () => { if (!/^https:|^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error(`not https: ${url}`); return url.startsWith("https") ? "https" : "local http"; });
await check("liveness /api/health", async () => { const r = await fetch(`${url}/api/health`); if (!r.ok) throw new Error(r.status); });
await check("readiness /api/ready (database reachable)", async () => { const r = await fetch(`${url}/api/ready`); if (!r.ok) throw new Error(r.status); });
await check("SPA is served with the security headers (CSP, nosniff, frame denial, HSTS on https)", async () => {
  const r = await fetch(`${url}/projects`); if (!r.ok) throw new Error(r.status);
  const h = r.headers; const need = ["content-security-policy", "x-content-type-options", "x-frame-options"];
  const missing = need.filter(k => !h.get(k)); if (url.startsWith("https") && !h.get("strict-transport-security")) missing.push("strict-transport-security");
  if (missing.length) throw new Error(`missing: ${missing}`);
  if (/unsafe-eval|script-src[^;]*unsafe-inline/.test(h.get("content-security-policy"))) throw new Error("CSP allows inline/eval scripts");
});
await check("anonymous API access is refused (401)", async () => { const r = await trpc("projects.list", { limit: 1 }, "GET", true); if (r.status !== 401) throw new Error(`got ${r.status}`); });
await check("anonymous realtime stream is refused (401)", async () => { const r = await fetch(`${url}/api/realtime/stream?scopes=workspace:frankfurt`); if (r.status !== 401) throw new Error(`got ${r.status}`); });
await check("metrics are not public", async () => { const r = await fetch(`${url}/api/metrics`); if (r.status === 200) throw new Error("metrics exposed without a token"); });
await check("demo login is off", async () => { const r = await trpc("auth.demoLogin", { email: "admin@bahn.de", password: "admin" }, "POST", true); if (r.status === 200) throw new Error("demo login works on this deployment"); });
await check("cross-origin cookie-authenticated POST is rejected (CSRF)", async () => { const r = await fetch(`${url}/api/trpc/auth.logout`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", cookie: "app_session_id=x" }, body: "{}" }); if (r.status !== 403) throw new Error(`got ${r.status}`); });

if (!token) for (const n of ["authenticated identity (auth.session)", "server-side paged project list with feed head", "project detail + version", "realtime stream hello within 5 s", "presence heartbeat + snapshot", "notifications list"]) skip(n);
else {
  let firstId, version;
  await check("authenticated identity (auth.session)", async () => { const r = await trpc("auth.session"); if (r.status !== 200 || !r.data?.id) throw new Error(JSON.stringify(r.error ?? r)); return `${r.data.role} ${JSON.stringify(r.data.workspaces)}`; });
  await check("server-side paged project list with feed head", async () => { const r = await trpc("projects.list", { limit: 20, expand: [] }); if (r.status !== 200 || !Array.isArray(r.data.items) || typeof r.data.feedHead !== "number") throw new Error(JSON.stringify(r.error ?? Object.keys(r.data ?? {}))); if (r.data.items.length > 20) throw new Error("page cap violated"); firstId = r.data.items[0]?.id; return `${r.data.items.length} rows, feedHead ${r.data.feedHead}`; });
  await check("project detail + version", async () => { if (!firstId) throw new Error("no visible project (workspace claim?)"); const r = await trpc("projects.get", { id: firstId }); if (r.status !== 200 || !(r.data.version >= 1)) throw new Error(JSON.stringify(r.error)); version = r.data.version; });
  await check("realtime stream hello within 5 s", async () => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 5000);
    try { const r = await fetch(`${url}/api/realtime/stream?scopes=${encodeURIComponent("workspace:frankfurt")}`, { headers: { ...auth, accept: "text/event-stream" }, signal: ac.signal });
      if (r.status !== 200 && r.status !== 403) throw new Error(`stream ${r.status}`);
      if (r.status === 403) return "authorized scopes empty for this token (403) — stream auth enforced";
      const reader = r.body.getReader(); let text = ""; while (!text.includes("event: hello")) { const c = await reader.read(); if (c.done) break; text += new TextDecoder().decode(c.value); }
      if (!text.includes("event: hello")) throw new Error("no hello frame"); return /headSeq":(\d+)/.exec(text)?.[0] ?? "hello"; } finally { clearTimeout(t); ac.abort(); } });
  await check("presence heartbeat + snapshot", async () => {
    if (!firstId) throw new Error("no project");
    const p = await fetch(`${url}/api/realtime/presence`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ scope: `project:${firstId}`, state: "viewing", tabId: "smoke-tab-0001" }) });
    if (p.status !== 204) throw new Error(`heartbeat ${p.status}`);
    const g = await (await fetch(`${url}/api/realtime/presence?scope=project:${firstId}`, { headers: auth })).json();
    await fetch(`${url}/api/realtime/presence?scope=project:${firstId}&tabId=smoke-tab-0001`, { method: "DELETE", headers: auth });
    if (!g.members.some(m => m.state === "viewing")) throw new Error("own presence not visible");
  });
  await check("notifications list", async () => { const r = await trpc("notifications.list", { limit: 5 }); if (r.status !== 200) throw new Error(JSON.stringify(r.error)); });
}
const failed = results.filter(r => r.status === "fail").length, notRun = results.filter(r => r.status === "not-run").length;
console.log(JSON.stringify({ suite: "staging-smoke", url, finishedAt: new Date().toISOString(), passed: results.filter(r => r.status === "pass").length, failed, notRun, ok: failed === 0 && notRun === 0, results }, null, 2));
process.exit(failed === 0 && notRun === 0 ? 0 : 1);
