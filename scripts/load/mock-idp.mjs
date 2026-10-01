#!/usr/bin/env node
/**
 * LOCAL load/dev identity provider (NOT Microsoft Entra, NOT evidence of Entra behaviour): serves a JWKS and mints RS256
 * bearer tokens that the production server verifies exactly like Entra tokens (issuer, audience, signature, expiry, claims).
 *
 *   node scripts/load/mock-idp.mjs --port 3290 [--aud load]        prints {issuer, audience, jwks, token}; keeps running
 *   TOKEN=$(curl -s "http://127.0.0.1:3290/token?role=admin&workspaces=ALL&oid=load-admin")
 *
 * Server env to use with it: OIDC_ISSUER=http://127.0.0.1:3290/ OIDC_AUDIENCE=load OIDC_JWKS_URI=http://127.0.0.1:3290/jwks
 */
import { createServer } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 3290)), AUD = arg("aud", "load");
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "mock", alg: "RS256", use: "sig" };
const ISS = `http://127.0.0.1:${PORT}/`;
const mint = (q) => new SignJWT({
  tid: "t-mock", oid: q.oid ?? "load-user", name: q.name ?? q.oid ?? "Load User", preferred_username: `${q.oid ?? "load-user"}@mock.invalid`,
  roles: (q.role ?? "editor").split(","), ...(q.workspaces ? { workspaces: q.workspaces.split(",") } : {}), ...(q.departments ? { departments: q.departments.split(",") } : {}),
}).setProtectedHeader({ alg: "RS256", kid: "mock" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime(q.ttl ?? "8h").sign(privateKey);

createServer(async (req, res) => {
  const u = new URL(req.url, ISS);
  if (u.pathname === "/jwks") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); return; }
  if (u.pathname === "/token") { res.setHeader("content-type", "text/plain"); res.end(await mint(Object.fromEntries(u.searchParams))); return; }
  res.statusCode = 404; res.end();
}).listen(PORT, "127.0.0.1", async () => {
  console.log(JSON.stringify({ issuer: ISS, audience: AUD, jwks: `${ISS}jwks`, tokenUrl: `${ISS}token?role=admin&workspaces=ALL&oid=load-admin` }));
});
