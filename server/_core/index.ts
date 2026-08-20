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
import { serveStatic, setupVite } from "./vite";

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
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
    server.close((err) => {
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
