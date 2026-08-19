import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts", 
      "server/**/*.spec.ts",
      // Pure-logic tests for the shared vocabularies and the checklist. These
      // need no DATABASE_URL, so unlike the server suite they actually run.
      "shared/**/*.test.ts",
      // pure logic extracted from client hooks (no DOM needed)
      "client/src/**/*.test.ts",
      // NEW: End-to-end sync tests for perfect JSON ↔ DB round-trip
      "server/**/*.sync.test.ts",
      "tests/e2e/**/*.test.ts"
    ],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "client"],
    },
    // Perfect execution: parallel threads for faster test runs on large data.json
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 4,
      },
    },
  },
});
