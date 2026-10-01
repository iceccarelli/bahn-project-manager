/** Proves staging-smoke.mjs itself works: boots the built server-mode bundle + a test IdP locally and runs it. */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "s", alg: "RS256", use: "sig" };
const idp = createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
await new Promise<void>(r => idp.listen(0, "127.0.0.1", r));
const ISS = `http://127.0.0.1:${(idp.address() as any).port}/`;
const mint = (oid: string, roles: string[], workspaces?: string[]) => new SignJWT({ tid: "t", oid, name: oid, roles, ...(workspaces ? { workspaces } : {}) }).setProtectedHeader({ alg: "RS256", kid: "s" }).setIssuer(ISS).setAudience("smoke").setExpirationTime("1h").sign(privateKey);
const token = await mint("smoke-admin", ["admin"], ["ALL"]), tokenR = await mint("smoke-frankfurt", ["editor"], ["Frankfurt"]), tokenN = await mint("smoke-noclaim", ["editor"]);
const port = 3395;
const srv = spawn("node", [`${process.env.SMOKE_DIST ?? "dist-e2e"}/index.js`], { env: { ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_URL: process.env.SMOKE_DATABASE_URL ?? "mysql://bahn:bahn@127.0.0.1:3306/bahn_e2e", JWT_SECRET: "s".repeat(48), ALLOW_SINGLE_INSTANCE: "1", OIDC_ISSUER: ISS, OIDC_AUDIENCE: "smoke", OIDC_JWKS_URI: `${ISS}jwks`, METRICS_TOKEN: "smoke" }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { if ((await fetch(`http://127.0.0.1:${port}/api/ready`).catch(() => null))?.ok) break; await new Promise(r => setTimeout(r, 300)); }
const smoke = spawn("node", ["scripts/gate/staging-smoke.mjs"], { env: { ...process.env, STAGING_URL: `http://127.0.0.1:${port}`, SMOKE_TOKEN: token, SMOKE_TOKEN_RESTRICTED: tokenR, SMOKE_TOKEN_NOCLAIM: tokenN, METRICS_TOKEN: "smoke" }, stdio: "inherit" });
const code: number = await new Promise(r => smoke.on("exit", c => r(c ?? 1)));
srv.kill("SIGTERM"); idp.close();

process.exit(code);
