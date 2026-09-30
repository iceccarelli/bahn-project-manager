/** Gateway failure modes that took the process down under load (found with the 1000-connection probe). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InProcessBus } from "./hub";
import { registerRealtimeGateway } from "./gateway";
import { admin, mitteOnly } from "../domain/testFixtures";
import type { Principal } from "../domain/permissions";

describe("realtime gateway resilience", () => {
  let server: Server, url: string, dbCalls = 0, failDb = true, failAuth = false;
  beforeAll(async () => {
    const app = express();
    registerRealtimeGateway(app, {
      subscriber: new InProcessBus(),
      store: { versions: async () => { dbCalls++; if (failDb) throw new Error("Queue limit reached."); return new Map(); } },
      resolve: async req => {
        if (failAuth) throw new Error("auth backend down");
        const p: Principal | undefined = req.headers["x-u"] === "mia" ? mitteOnly : req.headers["x-u"] === "admin" ? admin : undefined;
        return p ? { principal: p } : null;
      },
    });
    await new Promise<void>(r => (server = app.listen(0, "127.0.0.1", r)));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/realtime/stream`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });

  it("a failing project lookup is a 503 with Retry-After, not an unhandled rejection", async () => {
    const res = await fetch(`${url}?scopes=project:1`, { headers: { "x-u": "mia" } });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
  });

  it("a failing auth backend is a 503, and the server keeps serving", async () => {
    failAuth = true;
    expect((await fetch(`${url}?scopes=project:1`, { headers: { "x-u": "admin" } })).status).toBe(503);
    failAuth = false;
    expect((await fetch(`${url}?scopes=project:1`)).status).toBe(401);
  });

  it("unrestricted principals never touch the database to subscribe", async () => {
    dbCalls = 0;
    const ac = new AbortController();
    const res = await fetch(`${url}?scopes=project:1,project:2,workspace:frankfurt`, { headers: { "x-u": "admin" }, signal: ac.signal });
    expect(res.status).toBe(200);
    ac.abort();
    expect(dbCalls).toBe(0);
  });
});
