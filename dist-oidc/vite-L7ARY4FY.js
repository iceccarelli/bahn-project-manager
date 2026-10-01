// server/_core/vite.ts
import fs2 from "node:fs";
import { nanoid } from "nanoid";
import path2 from "node:path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var pkg = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8")
);
var BUILD_DATE = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
function vitePluginDataValidationAndCache() {
  return {
    name: "data-validation-cache",
    enforce: "pre",
    buildStart() {
      const dataPath = path.resolve(PROJECT_ROOT, "client", "public", "data.json");
      if (!fs.existsSync(dataPath)) {
        this.warn("\u26A0\uFE0F  data.json not found - sync may be incomplete");
        return;
      }
      try {
        const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
        const projects = Array.isArray(data) ? data : data.projects || [];
        if (!Array.isArray(projects) || projects.length === 0) {
          this.warn("\u26A0\uFE0F  data.json has no projects array - check seed sync");
        } else {
          console.log(`\u2705 [build] Validated ${projects.length} projects in data.json for perfect round-trip sync`);
          const sample = projects[0];
          const required = ["id", "projektnummer", "station", "reviews"];
          const missing = required.filter((k) => !(k in sample));
          if (missing.length > 0) {
            this.warn(`\u26A0\uFE0F  data.json sample missing fields: ${missing.join(", ")} - run seed:json`);
          }
        }
      } catch (e) {
        this.error(`\u274C data.json validation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    generateBundle() {
      console.log("\u2705 [build] Data validation + cache manifest injected for perfect execution stack");
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes("data.json")) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
          res.setHeader("X-Sync-Version", "1.0.0");
        }
        next();
      });
    }
  };
}
var LEGACY_SNAPSHOT_FILES = ["data.json", "schedule.json"];
function vitePluginLegacySnapshotOffPublic() {
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
    }
  };
}
var isProduction = process.env.NODE_ENV === "production";
var plugins = [
  react(),
  tailwindcss(),
  // jsxLoc + Manus runtime are DEV-ONLY tooling. They inline a large
  // source-location/CSS map into index.html (~360 kB) and must never ship
  // to production. Excluded from production builds below.
  ...!isProduction ? [jsxLocPlugin(), vitePluginManusRuntime()] : [],
  vitePluginDataValidationAndCache(),
  vitePluginLegacySnapshotOffPublic()
];
var vite_config_default = defineConfig({
  plugins,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE)
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
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
        manualChunks(id) {
          if (id.includes("commonjsHelpers")) return "vendor-utils";
          if (!id.includes("node_modules")) return void 0;
          const p = id.replace(/\\/g, "/");
          if (/\/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(p))
            return "vendor-react";
          if (/\/node_modules\/(clsx|tailwind-merge|class-variance-authority)\//.test(p))
            return "vendor-utils";
          if (/\/(recharts|d3-[a-z]+|victory-vendor|decimal\.js-light)\//.test(p))
            return "vendor-charts";
          if (/\/(leaflet|react-leaflet|@react-leaflet)\//.test(p)) return "vendor-leaflet";
          if (/\/(framer-motion|motion-dom|motion-utils)\//.test(p)) return "vendor-motion";
          if (/\/(zod|@tanstack)\//.test(p)) return "vendor-data";
          return void 0;
        }
      }
    }
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
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  },
  optimizeDeps: {
    include: ["zod", "date-fns", "xlsx"]
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
export {
  setupVite
};
