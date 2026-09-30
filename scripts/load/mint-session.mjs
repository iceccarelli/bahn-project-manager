#!/usr/bin/env node
/** Print a signed session cookie value for a seeded user. JWT_SECRET must match the server's. */
import { SignJWT } from "jose";
const [, , openId = "load-admin", name = "Load Admin"] = process.argv;
const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
if (!process.env.JWT_SECRET) { console.error("JWT_SECRET required"); process.exit(2); }
process.stdout.write(await new SignJWT({ openId, appId: process.env.VITE_APP_ID ?? "bahn-project-manager", name })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime("8h").sign(secret));
