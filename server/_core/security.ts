/**
 * HTTP hardening for the Express server (no helmet dependency: the header set
 * is small and every value is deliberate).
 *
 *  - CSP: same-origin scripts; OSM tiles for the map; inline styles only
 *    (Recharts/Radix set style attributes). No inline or eval'd scripts.
 *  - HSTS in production, nosniff, frame denial, strict referrer.
 *  - CORS: none by default (same-origin SPA). ALLOWED_ORIGINS opts specific
 *    origins in, with credentials, never "*".
 *  - CSRF: cookie-authenticated state-changing requests must be same-origin
 *    (Origin check). Bearer-token requests carry no ambient credentials.
 */
import type { NextFunction, Request, Response } from "express";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const allowedOrigins = () =>
  new Set((process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean));

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  res.removeHeader("X-Powered-By");
  next();
}

export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, traceparent, x-request-id, x-trace-id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "x-trace-id, x-request-id");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
}

export function sameOriginForCookies(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser client (curl, k6): no ambient cookie attack surface
  let host: string;
  try { host = new URL(origin).host; } catch { res.status(403).json({ error: "bad origin" }); return; }
  if (host === req.headers.host || allowedOrigins().has(origin)) return next();
  res.status(403).json({ error: "cross-origin request rejected" });
}

/** Refuse to boot production with development secrets. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /demo|change/i.test(env.JWT_SECRET)) problems.push("JWT_SECRET must be set to a random value of at least 32 characters");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");
  if (!env.OIDC_ISSUER && env.ALLOW_DEMO_LOGIN !== "1" && !env.OAUTH_SERVER_URL) problems.push("configure OIDC_ISSUER/OIDC_AUDIENCE (or explicitly ALLOW_DEMO_LOGIN=1 for a demo deployment)");
  if (problems.length) throw new Error(`Unsafe production configuration:\n - ${problems.join("\n - ")}`);
}
