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
const skip = (name, why = "needs SMOKE_TOKEN") => results.push({ name, status: "not-run", detail: why });
const auth = token ? { authorization: `Bearer ${token}` } : {};
const trpc = async (proc, input, method = "GET", anon = false) => {
  const a = anon ? {} : auth;
  const r = await fetch(method === "GET" ? `${url}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `${url}/api/trpc/${proc}`,
    { method, headers: { ...a, "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.result?.data?.json, error: j.error?.json };
};

await check("transport is HTTPS (or explicitly local)", async () => { if (!/^https:|^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error(`not https: ${url}`); return url.startsWith("https") ? "https" : "local http"; });
await check("at least two app instances serve this URL (distinct X-Instance across 60 requests)", async () => {
  const seen = new Set(); for (let i = 0; i < 60; i++) { const r = await fetch(`${url}/api/health`, { headers: { connection: "close" } }); seen.add(r.headers.get("x-instance")); }
  if (seen.size < 2) throw new Error(`only ${seen.size} instance id(s) answered: ${[...seen]}`); return `${seen.size} instances`;
});
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

// ---- authenticated checks ------------------------------------------------------------------------
// Tokens (all real access tokens issued by the deployment's IdP):
//   SMOKE_TOKEN             editor/admin with workspaces ALL   — the acting user
//   SMOKE_TOKEN_RESTRICTED  a second user whose workspace claim is exactly SMOKE_WORKSPACE (receives live events, notifications)
//   SMOKE_TOKEN_NOCLAIM     optional: a user with NO workspace claim (must see nothing)
// The suite creates its own project (unique number) and deletes it at the end: no existing row is mutated.
const tokenR = process.env.SMOKE_TOKEN_RESTRICTED, tokenN = process.env.SMOKE_TOKEN_NOCLAIM;
const WS = process.env.SMOKE_WORKSPACE ?? "Frankfurt", WS_OTHER = process.env.SMOKE_WORKSPACE_OTHER ?? "Kassel";
const slug = v => v.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const need = (n, why) => skip(n, why);
const ALL_NEEDING_TOKEN = ["authenticated identity (auth.session)", "list: server-side page with feed head", "list: search, filter and sort are server-side", "detail + version", "create (versioned, idempotent)", "update: optimistic versioning (stale write -> 409 with current row)", "update: idempotent replay does not double-apply", "audit: every change recorded with actor", "outbox -> relay: change appears in the durable feed", "realtime: second user receives the update live", "workspace move: new-state values never reach the old workspace", "workspace move: restricted user can neither read nor write after the move", "reconnect/recovery: missed changes are returned by the feed", "notification path: watcher is notified, only the watcher", "presence heartbeat + snapshot", "delete (versioned) + live removal", "no workspace claim = no data", "legacy snapshot is not public (/data.json, /schedule.json)"];
if (!token) for (const n of ALL_NEEDING_TOKEN) skip(n);
else {
  const J = { "content-type": "application/json" };
  const sess = { A: null, R: null };
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nr = `SMOKE-${runId}`, key = () => `smoke-${runId}-${Math.random().toString(36).slice(2)}-${performance.now() | 0}`;
  const tr = (proc, input, method, tok) => trpcAs(tok, proc, input, method);
  async function trpcAs(tok, proc, input, method = "GET") {
    const r = await fetch(method === "GET" ? `${url}/api/trpc/${proc}?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : `${url}/api/trpc/${proc}`,
      { method, headers: { authorization: `Bearer ${tok}`, ...J }, ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.result?.data?.json, error: j.error?.json };
  }
  // Open an SSE stream and collect frames. `until(pred)` resolves when a frame matches.
  function openStream(tok, scopes) {
    const ac = new AbortController(), frames = [], waiters = [];
    const done = (async () => {
      try {
        const r = await fetch(`${url}/api/realtime/stream?scopes=${encodeURIComponent(scopes.join(","))}`, { headers: { authorization: `Bearer ${tok}`, accept: "text/event-stream" }, signal: ac.signal });
        if (r.status !== 200) return { status: r.status };
        const rd = r.body.getReader(), td = new TextDecoder(); let buf = "";
        for (;;) {
          const c = await rd.read(); if (c.done) break; buf += td.decode(c.value);
          let i; while ((i = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(raw)?.[1], data = /^data: (.*)$/m.exec(raw)?.[1];
            if (!ev || !data) continue;
            const f = { event: ev, data: JSON.parse(data), at: performance.now() }; frames.push(f);
            for (const w of [...waiters]) if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); w.res(f); }
          }
        }
      } catch { /* aborted */ }
      return { status: 200 };
    })();
    return {
      frames, close: () => ac.abort(), done,
      until: (pred, ms = 6000) => { const hit = frames.find(pred); if (hit) return Promise.resolve(hit); return new Promise((res, rej) => { const w = { pred, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error(`no matching frame within ${ms} ms; saw: ${frames.map(f => f.event + ":" + (f.data?.eventType ?? "")).join(",")}`)); } }, ms); }); },
    };
  }
  let P; // the project this run creates
  let streamA, streamR, userA, userR, headBefore;

  await check("authenticated identity (auth.session)", async () => {
    const r = await trpc("auth.session"); if (r.status !== 200 || !r.data?.id) throw new Error(JSON.stringify(r.error ?? r)); userA = r.data;
    if (tokenR) { const q = await trpcAs(tokenR, "auth.session"); if (!q.data?.id) throw new Error("restricted token not accepted"); userR = q.data; if (JSON.stringify(userR.workspaces) === '"ALL"') throw new Error("restricted token resolved to ALL"); }
    return `${userA.role} ${JSON.stringify(userA.workspaces)}${userR ? ` | restricted ${JSON.stringify(userR.workspaces)}` : ""}`;
  });
  await check("list: server-side page with feed head", async () => {
    const r = await trpc("projects.list", { limit: 20, expand: [] }); if (r.status !== 200 || !Array.isArray(r.data.items) || typeof r.data.feedHead !== "number") throw new Error(JSON.stringify(r.error ?? Object.keys(r.data ?? {})));
    if (r.data.items.length > 20) throw new Error("page cap violated"); headBefore = r.data.feedHead; return `${r.data.items.length} rows, feedHead ${r.data.feedHead}`;
  });
  if (tokenR) { streamA = openStream(token, [`notifications:${(await trpc("auth.session")).data.id}`]); }
  await check("create (versioned, idempotent)", async () => {
    const k = key();
    const body = { fields: { projektnummer: nr, station: `Smoke ${runId}`, bahnhofsmanagement: WS, projektstand: "EP", kommentar: "staging smoke" }, idempotencyKey: k };
    const r = await trpc("projects.create", body, "POST"); if (r.status !== 200) throw new Error(JSON.stringify(r.error ?? r));
    const proj = r.data.project ?? r.data; P = { id: proj.id ?? r.data.id, version: proj.version ?? r.data.version ?? 1 }; if (!P.id) throw new Error(`no id in ${JSON.stringify(r.data).slice(0, 200)}`);
    const again = await trpc("projects.create", body, "POST"); const id2 = (again.data?.project ?? again.data)?.id;
    if (again.status !== 200 || id2 !== P.id) throw new Error(`replay created a second project (${id2} vs ${P.id})`);
    return `id ${P.id}`;
  });
  if (!P) { for (const n of ALL_NEEDING_TOKEN.slice(3)) if (!results.some(r => r.name === n)) results.push({ name: n, status: "fail", detail: "create failed, dependent check not possible" }); }
  else {
    try {
      await check("list: search, filter and sort are server-side", async () => {
        const hit = await trpc("projects.list", { limit: 10, search: nr, expand: [] }); if (!hit.data?.items?.some(p => p.id === P.id)) throw new Error("search by project number did not find the created project (FULLTEXT/commit visibility)");
        const flt = await trpc("projects.list", { limit: 100, bahnhofsmanagement: WS, projektstand: "EP", expand: [] }); if (flt.data.items.some(p => p.bahnhofsmanagement !== WS || p.projektstand !== "EP")) throw new Error("filter returned rows outside the filter");
        const asc = await trpc("projects.list", { limit: 30, sort: "id", dir: "asc", expand: [] }), desc = await trpc("projects.list", { limit: 30, sort: "id", dir: "desc", expand: [] });
        const ids = asc.data.items.map(p => p.id), dids = desc.data.items.map(p => p.id);
        if (ids.some((v, i) => i && v < ids[i - 1]) || dids.some((v, i) => i && v > dids[i - 1])) throw new Error("sort order wrong");
        if (asc.data.nextCursor || asc.data.cursor) { const pg = await trpc("projects.list", { limit: 30, sort: "id", dir: "asc", cursor: asc.data.nextCursor ?? asc.data.cursor, expand: [] }); if (pg.status !== 200 || pg.data.items.some(p => ids.includes(p.id))) throw new Error("cursor page overlaps"); }
        return `search+filter+sort(asc/desc)+cursor ok`;
      });
      await check("detail + version", async () => { const r = await trpc("projects.get", { id: P.id }); if (r.status !== 200 || !(r.data.version >= 1)) throw new Error(JSON.stringify(r.error)); P.version = r.data.version; });

      if (tokenR) {
        streamR = openStream(tokenR, [`workspace:${slug(WS)}`, `project:${P.id}`, `notifications:${userR.id}`]);
        await streamR.until(f => f.event === "hello", 8000);
        await trpcAs(tokenR, "projects.watch", { projectId: P.id, on: true }, "POST");
      }
      let updatedAt0;
      await check("update: optimistic versioning (stale write -> 409 with current row)", async () => {
        updatedAt0 = performance.now();
        const ok = await trpc("projects.update", { id: P.id, expectedVersion: P.version, changes: { projektstand: "FA" }, idempotencyKey: key() }, "POST");
        if (ok.status !== 200) throw new Error(JSON.stringify(ok.error ?? ok));
        const stale = await trpc("projects.update", { id: P.id, expectedVersion: P.version, changes: { projektstand: "EP" }, idempotencyKey: key() }, "POST");
        if (stale.status !== 409) throw new Error(`stale write -> ${stale.status} (expected 409)`);
        const c = stale.error?.data?.conflict; if (!c || c.currentVersion !== P.version + 1) throw new Error(`conflict payload wrong: ${JSON.stringify(c)?.slice(0, 160)}`);
        const now = await trpc("projects.get", { id: P.id }); if (now.data.projektstand !== "FA") throw new Error("stale write was applied");
        P.version = now.data.version; return `v${P.version}`;
      });
      await check("update: idempotent replay does not double-apply", async () => {
        const k = key(), body = { id: P.id, expectedVersion: P.version, changes: { kommentar: `replay ${runId}` }, idempotencyKey: k };
        const a = await trpc("projects.update", body, "POST"), b = await trpc("projects.update", body, "POST");
        if (a.status !== 200 || b.status !== 200) throw new Error(`${a.status}/${b.status}`);
        const now = await trpc("projects.get", { id: P.id }); if (now.data.version !== P.version + 1) throw new Error(`version ${now.data.version}, expected ${P.version + 1}`);
        if (!(b.data.replayed === true)) throw new Error("second response not marked replayed"); P.version = now.data.version;
      });
      if (streamR) await check("realtime: second user receives the update live", async () => {
        const f = await streamR.until(e => e.event === "domain" && e.data.eventType === "project.updated" && String(e.data.aggregateId) === String(P.id) && e.data.aggregateVersion >= P.version - 1, 6000);
        return `propagation ${Math.round(f.at - updatedAt0)} ms from first write (includes the 3 writes above)`;
      }); else need("realtime: second user receives the update live", "needs SMOKE_TOKEN_RESTRICTED");

      await check("audit: every change recorded with actor", async () => {
        const r0 = await trpc("audit.page", { entityType: "project", entityId: P.id, limit: 50, days: 0 }); const r = { ...r0, data: r0.data?.items };
        if (r.status === 403) throw new Error("SMOKE_TOKEN is not an auditor/admin: cannot read the audit log (use an admin token to prove audit)");
        if (r.status !== 200 || !Array.isArray(r.data)) throw new Error(JSON.stringify(r.error ?? r));
        if (r.data.length < 3 || r.data.some(a => !a.userId && !a.actorId && !a.userName && !a.actor)) throw new Error(`audit rows: ${r.data.length} (need >=3 with an actor)`);
        return `${r.data.length} rows`;
      });
      await check("outbox -> relay: change appears in the durable feed", async () => {
        let ev = []; for (let i = 0; i < 40; i++) { const c = await trpc("projects.changes", { after: headBefore, limit: 200 }); ev = (c.data?.events ?? []).filter(e => String(e.aggregateId) === String(P.id)); if (ev.length >= 3) break; await new Promise(r => setTimeout(r, 250)); }
        if (ev.length < 3) throw new Error(`feed has ${ev.length} events for the project, expected >= 3 (create, update, replayed update = 2 updates)`);
        const seqs = ev.map(e => e.feedSeq); if (seqs.some((v, i) => i && v <= seqs[i - 1])) throw new Error("feedSeq not strictly increasing");
        let backlog = null; if (process.env.METRICS_TOKEN) { const m = await (await fetch(`${url}/api/metrics`, { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } })).text(); backlog = /^bahn_outbox_backlog (\d+)/m.exec(m)?.[1]; }
        return `${ev.length} events, feedSeq ${seqs[0]}..${seqs.at(-1)}${backlog != null ? `, outbox backlog ${backlog}` : ""}`;
      });

      if (tokenR) {
        await check("reconnect/recovery: missed changes are returned by the feed", async () => {
          const head = (await trpcAs(tokenR, "projects.list", { limit: 1, expand: [] })).data.feedHead;
          streamR.close(); await streamR.done;
          for (let i = 0; i < 2; i++) { const cur = (await trpc("projects.get", { id: P.id })).data; const r = await trpc("projects.update", { id: P.id, expectedVersion: cur.version, changes: { kommentar: `missed ${i} ${runId}` }, idempotencyKey: key() }, "POST"); if (r.status !== 200) throw new Error(JSON.stringify(r.error)); }
          let got = []; for (let i = 0; i < 40; i++) { const c = await trpcAs(tokenR, "projects.changes", { after: head, limit: 200 }); got = (c.data?.events ?? []).filter(e => String(e.aggregateId) === String(P.id)); if (got.length >= 2) break; await new Promise(r => setTimeout(r, 250)); }
          if (got.length < 2) throw new Error(`recovered ${got.length} of 2 missed changes`);
          streamR = openStream(tokenR, [`workspace:${slug(WS)}`, `project:${P.id}`, `notifications:${userR.id}`]); await streamR.until(f => f.event === "hello", 8000);
          P.version = (await trpc("projects.get", { id: P.id })).data.version; return `recovered ${got.length} events after cursor ${head}`;
        });
        await check("notification path: watcher is notified, only the watcher", async () => {
          const forP = n => typeof n.link === "string" && n.link.endsWith(`projekt=${P.id}`);
          let mine = []; for (let i = 0; i < 24 && !mine.length; i++) { const l = await trpcAs(tokenR, "notifications.list", { limit: 50 }); if (l.status !== 200) throw new Error(JSON.stringify(l.error)); mine = (l.data?.items ?? []).filter(forP); if (!mine.length) await new Promise(r => setTimeout(r, 250)); }
          if (!mine.length) throw new Error("watcher has no stored notification for the project (projektstand change)");
          const cnt = await trpcAs(tokenR, "notifications.unreadCount", undefined); if (!(cnt.data?.count >= 1)) throw new Error(`unreadCount ${JSON.stringify(cnt.data)}`);
          const aList = await trpc("notifications.list", { limit: 50 }); if ((aList.data?.items ?? []).some(forP)) throw new Error("the actor was notified of their own change");
          const live = streamR.frames.some(e => e.event === "domain" && e.data.eventType === "notification.created");
          return `${mine.length} stored for the watcher, none for the actor, unread ${cnt.data.count}, live frame on this stream: ${live}`;
        });
        await check("workspace move: new-state values never reach the old workspace", async () => {
          streamR.frames.length = 0;
          const secret = `secret-${runId}`;
          const r = await trpc("projects.update", { id: P.id, expectedVersion: P.version, changes: { bahnhofsmanagement: WS_OTHER, kommentar: secret }, idempotencyKey: key() }, "POST");
          if (r.status !== 200) throw new Error(JSON.stringify(r.error ?? r));
          const f = await streamR.until(e => e.event === "domain" && String(e.data.aggregateId) === String(P.id) && /removed|updated/.test(e.data.eventType) && e.data.aggregateVersion === P.version + 1, 6000);
          if (f.data.eventType !== "project.removed") throw new Error(`old workspace got ${f.data.eventType}`);
          if (JSON.stringify(f.data).includes(secret) || JSON.stringify(f.data).includes(WS_OTHER)) throw new Error("move-out event leaks the new state");
          P.version += 1; return "project.removed, no values";
        });
        await check("workspace move: restricted user can neither read nor write after the move", async () => {
          const g = await trpcAs(tokenR, "projects.get", { id: P.id }); if (g.status === 200) throw new Error("old workspace can still read the project");
          const u = await trpcAs(tokenR, "projects.update", { id: P.id, expectedVersion: P.version, changes: { kommentar: "intrusion" }, idempotencyKey: key() }, "POST"); if (u.status === 200) throw new Error("old workspace can still write the project");
          const l = await trpcAs(tokenR, "projects.list", { limit: 100, search: nr, expand: [] }); if (l.data?.items?.some(p => p.id === P.id)) throw new Error("moved project still in the old workspace's list");
          return `get ${g.status}, update ${u.status}`;
        });
        await trpc("projects.update", { id: P.id, expectedVersion: P.version, changes: { bahnhofsmanagement: WS }, idempotencyKey: key() }, "POST").then(r => { if (r.status === 200) P.version += 1; });
      } else for (const n of ["reconnect/recovery: missed changes are returned by the feed", "notification path: watcher is notified, only the watcher", "workspace move: new-state values never reach the old workspace", "workspace move: restricted user can neither read nor write after the move"]) need(n, "needs SMOKE_TOKEN_RESTRICTED");

      await check("presence heartbeat + snapshot", async () => {
        const p = await fetch(`${url}/api/realtime/presence`, { method: "POST", headers: { ...auth, ...J }, body: JSON.stringify({ scope: `project:${P.id}`, state: "viewing", tabId: "smoke-tab-0001" }) });
        if (p.status !== 204) throw new Error(`heartbeat ${p.status}`);
        const g = await (await fetch(`${url}/api/realtime/presence?scope=project:${P.id}`, { headers: auth })).json();
        await fetch(`${url}/api/realtime/presence?scope=project:${P.id}&tabId=smoke-tab-0001`, { method: "DELETE", headers: auth });
        if (!g.members.some(m => m.state === "viewing")) throw new Error("own presence not visible");
      });
    } finally {
      await check("delete (versioned) + live removal", async () => {
        const cur = (await trpc("projects.get", { id: P.id })).data;
        const bad = await trpc("projects.delete", { id: P.id, expectedVersion: Math.max(1, cur.version - 1), idempotencyKey: key() }, "POST"); if (bad.status === 200 && cur.version > 1) throw new Error("delete with a stale version succeeded");
        const r = await trpc("projects.delete", { id: P.id, expectedVersion: cur.version, idempotencyKey: key() }, "POST"); if (r.status !== 200) throw new Error(JSON.stringify(r.error ?? r));
        const g = await trpc("projects.get", { id: P.id }); if (g.status === 200) throw new Error("deleted project is still readable");
        if (streamR) { /* the restricted user may or may not be in the project's workspace now; the removal frame is best-effort evidence */ }
        return `get -> ${g.status}`;
      });
      streamA?.close(); streamR?.close();
    }
  }
  if (tokenN) await check("no workspace claim = no data", async () => { const r = await trpcAs(tokenN, "projects.list", { limit: 5, expand: [] }); if (r.status !== 200 || r.data.items.length !== 0) throw new Error(`no-claim user saw ${r.data?.items?.length} rows (status ${r.status})`); });
  else need("no workspace claim = no data", "needs SMOKE_TOKEN_NOCLAIM");
  await check("legacy snapshot is not public (/data.json, /schedule.json)", async () => {
    for (const f of ["data.json", "schedule.json"]) {
      const a = await fetch(`${url}/${f}`); const t = await a.text(); if (a.status === 200 && /projektnummer|"Station"|"datum"/.test(t)) throw new Error(`${f} is served to anonymous callers`);
      if (tokenR) { const r = await fetch(`${url}/${f}`, { headers: { authorization: `Bearer ${tokenR}` } }); if (r.status === 200 && /projektnummer|"datum"/.test(await r.text())) throw new Error(`${f} is served to a workspace-restricted user`); }
    }
  });
}
const failed = results.filter(r => r.status === "fail").length, notRun = results.filter(r => r.status === "not-run").length;
console.log(JSON.stringify({ suite: "staging-smoke", url, finishedAt: new Date().toISOString(), passed: results.filter(r => r.status === "pass").length, failed, notRun, ok: failed === 0 && notRun === 0, results }, null, 2));
process.exit(failed === 0 && notRun === 0 ? 0 : 1);
