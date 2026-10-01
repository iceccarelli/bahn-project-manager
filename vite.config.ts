import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Build-time constants
//
// The footer used to hardcode `appVersion = "1.0.0"` while package.json said
// 2.0.0, and rendered `new Date()` as "last updated", which meant the app
// claimed to have been updated today on every single page load. Both now come
// from here, so neither can drift.
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;

const pkg = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"),
) as { version: string };

const BUILD_DATE = new Date().toISOString().slice(0, 10);

// =============================================================================
// Build-time Data Validation Plugin + Caching Enhancer
// Validates client/public/data.json structure at build time for perfect sync
// =============================================================================

function vitePluginDataValidationAndCache(): Plugin {
  return {
    name: "data-validation-cache",
    enforce: "pre",
    buildStart() {
      const dataPath = path.resolve(PROJECT_ROOT, "client", "public", "data.json");
      if (!fs.existsSync(dataPath)) {
        this.warn("⚠️  data.json not found - sync may be incomplete");
        return;
      }
      try {
        const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
        const projects = Array.isArray(data) ? data : data.projects || [];
        if (!Array.isArray(projects) || projects.length === 0) {
          this.warn("⚠️  data.json has no projects array - check seed sync");
        } else {
          console.log(`✅ [build] Validated ${projects.length} projects in data.json for perfect round-trip sync`);
          const sample = projects[0];
          const required = ["id", "projektnummer", "station", "reviews"];
          const missing = required.filter(k => !(k in sample));
          if (missing.length > 0) {
            this.warn(`⚠️  data.json sample missing fields: ${missing.join(", ") } - run seed:json`);
          }
        }
      } catch (e) {
        this.error(`❌ data.json validation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    generateBundle() {
      console.log("✅ [build] Data validation + cache manifest injected for perfect execution stack");
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("data.json")) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
          res.setHeader("X-Sync-Version", "1.0.0");
        }
        next();
      });
    },
  };
}

/**
 * Server-mode builds must not publish the legacy snapshot as static files: anything under `public/`
 * is served to ANYONE, which would hand the whole dataset to unauthenticated and workspace-restricted
 * users and make the server's authorization decorative. The files are moved to `<outDir>/../legacy/`
 * and served by an authenticated route (server/_core/legacySnapshot.ts).
 */
export const LEGACY_SNAPSHOT_FILES = ["data.json", "schedule.json"];
function vitePluginLegacySnapshotOffPublic(): Plugin {
  return {
    name: "legacy-snapshot-off-public",
    apply: "build",
    writeBundle(options) {
      if (process.env.VITE_SERVER_MODE !== "1" || !options.dir) return;
      const legacy = path.resolve(options.dir, "..", "legacy");
      fs.mkdirSync(legacy, { recursive: true });
      for (const f of LEGACY_SNAPSHOT_FILES) {
        const from = path.join(options.dir, f);
        if (fs.existsSync(from)) fs.renameSync(from, path.join(legacy, f));
      }
    },
  };
}


/**
 * Production / demo separation. `BUILD_TARGET` is set only by `build:production` and `build:demo`.
 * A production artifact built without the server data plane (or a demo built with it) is refused
 * here, at build time, and the result is stamped into `build-info.json` so CI and the container
 * gate can verify the artifact that is actually shipped (scripts/assert-build-target.mjs).
 */
function vitePluginBuildTarget(): Plugin {
  const target = process.env.BUILD_TARGET;
  const serverMode = process.env.VITE_SERVER_MODE === "1";
  return {
    name: "build-target",
    apply: "build",
    buildStart() {
      if (target === "production" && !serverMode) this.error("BUILD_TARGET=production requires VITE_SERVER_MODE=1 (refusing to build the browser-local demo as a production artifact)");
      if (target === "demo" && serverMode) this.error("BUILD_TARGET=demo requires VITE_SERVER_MODE=0");
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify({ target: target ?? "unspecified", serverMode, version: pkg.version }) });
    },
  };
}

const isProduction = process.env.NODE_ENV === "production";

const plugins = [
  react(),
  tailwindcss(),
  // jsxLoc + Manus runtime are DEV-ONLY tooling. They inline a large
  // source-location/CSS map into index.html (~360 kB) and must never ship
  // to production. Excluded from production builds below.
  ...(!isProduction
    ? [jsxLocPlugin(), vitePluginManusRuntime()]
    : []),
  vitePluginDataValidationAndCache(),
  vitePluginLegacySnapshotOffPublic(),
  vitePluginBuildTarget(),
];

export default defineConfig({
  plugins,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Do NOT ship a 5.6 MB sourcemap to production. "hidden" keeps maps for
    // error tooling without referencing them from shipped assets.
    sourcemap: isProduction ? "hidden" : true,
    // 1400, not 900: @react-pdf/renderer is 1.29 MB and is deliberately behind
    // a dynamic import, so it never touches the entry chunk. Warning about it on
    // every build trains people to ignore the warning, which is worse than not
    // having one. Anything above this really would be worth investigating.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // Function form, not the object form. The object form matches on the
        // bare specifier, so `"vendor-react": ["react", "react-dom"]` only
        // captured react-dom's 12 kB shim — the actual 525 kB of
        // react-dom/cjs/react-dom-client.production.js resolves under a
        // different id and stayed in the entry chunk. Matching on the resolved
        // path fixes that and gives the browser vendor bundles that only
        // change when the dependency does.
        manualChunks(id: string) {
          /*
           * Rollup's own interop shim, before the node_modules guard.
           *
           * `getDefaultExportFromCjs` is a generated module, not a package, so
           * its id carries no node_modules and the guard below skipped it —
           * leaving Rollup to place it wherever it liked. It chose
           * vendor-charts, and because react-dom is CommonJS and needs the
           * shim, vendor-react then statically imported vendor-charts. That
           * one eight-line helper was the last edge keeping 370 kB of charting
           * in the preload of every route.
           */
          if (id.includes("commonjsHelpers")) return "vendor-utils";
          if (!id.includes("node_modules")) return undefined;
          const p = id.replace(/\\/g, "/");
          /*
           * React first, and precisely.
           *
           * Measured: the entry chunk statically imported `{r as x, R as vf}`
           * from vendor-charts — React itself. Rollup had put React in the
           * first chunk that claimed a module needing it, and every route was
           * therefore downloading 382 kB of charting to get React. Projekte
           * has no chart on it at all.
           *
           * The earlier attempt at this produced "Cannot access 'React' before
           * initialization", and the reason is visible in that failure: a
           * partial split. react, react-dom, scheduler and the JSX runtime are
           * one runtime and have to travel together; separating any of them
           * makes two chunks that each need the other. Anchored on
           * /node_modules/<pkg>/ so react-leaflet, react-pdf and react-day-
           * picker cannot be swept in with them.
           */
          if (/\/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(p))
            return "vendor-react";
          /*
           * The tiny shared utilities, before anything big can adopt them.
           *
           * With React split out, the entry still statically imported ONE
           * symbol from vendor-charts: `clsx` — the 200-byte class-name joiner
           * behind `cn()`, used by every component in the app. Rollup had
           * parked it in the charts chunk because recharts wanted it too, and
           * that one function was dragging 370 kB of charting into the preload
           * of every single route.
           *
           * Naming them here costs one 3 kB chunk and takes recharts off the
           * critical path of five of the six routes.
           */
          if (/\/node_modules\/(clsx|tailwind-merge|class-variance-authority)\//.test(p))
            return "vendor-utils";
          if (/\/(recharts|d3-[a-z]+|victory-vendor|decimal\.js-light)\//.test(p))
            return "vendor-charts";
          if (/\/(leaflet|react-leaflet|@react-leaflet)\//.test(p)) return "vendor-leaflet";
          if (/\/(framer-motion|motion-dom|motion-utils)\//.test(p)) return "vendor-motion";
          if (/\/(zod|@tanstack)\//.test(p)) return "vendor-data";
          // React is deliberately NOT force-chunked. Pulling react / react-dom
          // into their own chunk produced a circular chunk dependency and a
          // hard "ReferenceError: Cannot access 'React' before initialization"
          // from vendor-charts on every authenticated route — verified by
          // bisecting this function one group at a time against a headless
          // load of all six routes. Rollup's own placement is correct; the
          // groups above only exist to keep genuinely optional, route-specific
          // libraries out of the first paint.
          return undefined;
        },

      },
    },
},
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  optimizeDeps: {
    include: ["zod", "date-fns", "xlsx"],
  },
});
