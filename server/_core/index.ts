import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import net from "node:net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerExcelRoutes } from "../excel";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { assertProductionConfig, cors, sameOriginForCookies, securityHeaders } from "./security";
import { resolveIdentity } from "./identity";
import { getServices } from "./services";
import { closeDb } from "../db";
import { canExport, isAdmin } from "../domain/permissions";
import { registerPresenceRoutes, registerRealtimeGateway } from "../realtime/gateway";
import { m, renderMetrics } from "../observability/metrics";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  assertProductionConfig();
  // Last line of defence, not a substitute for handling errors at boundaries:
  // count and log, and keep serving the other connections. Alert on this metric.
  process.on("unhandledRejection", (reason) => {
    m.unhandled.inc();
    console.error("[unhandledRejection]", reason);
  });
  const app = express();
  const server = createServer(app);
  // Behind Vercel/nginx/ALB: trust the first proxy hop for protocol and client IP.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors);
  app.use(sameOriginForCookies);
  // API bodies are small JSON. (The old 50 MB limit applied to every route;
  // the Excel import streams its own body with its own 25 MB cap.)
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ limit: "256kb", extended: false }));
  // Liveness/readiness probe. Plain HTTP rather than the tRPC `system.health`
  // procedure, because Docker HEALTHCHECK, Kubernetes probes and load-balancer
  // checks all speak GET-and-look-at-the-status-code, not tRPC.
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: process.env.npm_package_version ?? "unknown",
      uptime: Math.round(process.uptime()),
    });
  });

  // Data-plane services (DB pool, bus, outbox relay). Absent when DATABASE_URL
  // is unset — the static SPA deployment — in which case /api/trpc data routes
  // answer with an error rather than pretending.
  const services = await getServices();
  app.get("/api/ready", async (_req, res) => {
    try {
      if (!services) throw new Error("no database configured");
      await services.pool.query("SELECT 1");
      res.status(200).json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  // Prometheus scrape. Token-protected; no token configured = endpoint off.
  app.get("/api/metrics", (req, res) => {
    const token = process.env.METRICS_TOKEN;
    if (!token || req.headers.authorization !== `Bearer ${token}`) { res.status(404).end(); return; }
    res.type("text/plain; version=0.0.4").send(renderMetrics());
  });
  if (services) {
    registerRealtimeGateway(app, { subscriber: services.subscriber, store: services.store });
    registerPresenceRoutes(app, { presence: services.presence, store: services.store, onError: e => console.error("[presence]", e) });
  }

  // Bulk export/import were reachable by anyone. They are privileged now.
  const requirePrincipal = (allow: (p: import("../domain/permissions").Principal) => boolean) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const id = await resolveIdentity(req);
      if (!id) { res.status(401).json({ error: "unauthenticated" }); return; }
      if (!allow(id.principal)) { res.status(403).json({ error: "forbidden" }); return; }
      next();
    };
  app.use("/api/export", requirePrincipal(canExport));
  app.use("/api/import", requirePrincipal(isAdmin));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerExcelRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    /*
     * Loaded here, not at the top of the file.
     *
     * ./vite imports the bundler and vite.config.ts, both devDependencies. A
     * static import would resolve them the moment this module loads — in the
     * production image, where they are not installed, that is the process
     * exiting before it binds a port. A dynamic import inside the branch that
     * uses it never runs in production, and esbuild keeps it out of the
     * production bundle's import graph.
     */
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const isDev = process.env.NODE_ENV === "development";

  // Port hunting is a development convenience and a production hazard: inside a
  // container the orchestrator publishes and health-checks exactly $PORT, so
  // silently binding 3001 instead produces a container that is up, serving, and
  // permanently unreachable. In production we bind what we were told to bind
  // and fail loudly if we cannot.
  const port = isDev ? await findAvailablePort(preferredPort) : preferredPort;

  if (isDev && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Graceful shutdown. Without this, `docker stop` / a rolling deploy severs
  // in-flight requests at the TCP level and the orchestrator waits out the full
  // kill timeout on every single stop.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — draining connections`);
    // SSE streams never end on their own; ending them lets clients reconnect
    // to a healthy instance instead of holding the drain open.
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 5_000).unref();
    server.close(async (err) => {
      await services?.shutdown().catch(() => {});
      await closeDb().catch(() => {});
      if (err) {
        console.error("Error during shutdown:", err);
        process.exit(1);
      }
      process.exit(0);
    });
    // Backstop: a wedged keep-alive connection must not hold the process open
    // past the orchestrator's grace period.
    setTimeout(() => {
      console.error("Shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
